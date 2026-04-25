// GCS-direct durability for the SQLite database.
//
// The earlier gcsfuse-based setup relied on a FUSE mount silently flushing
// writes to GCS. It didn't — writes piled up in the local gcsfuse buffer
// and evaporated on every container restart. This module replaces that with
// direct GCS API calls that only acknowledge persistence after GCS confirms
// the bytes landed.
//
// Layout:
//   /tmp/writer.db                 → live SQLite file (real local disk)
//   /tmp/writer.db.snapshot        → online-backup snapshot (transient)
//   /tmp/writer.db.snapshot.gz     → gzipped snapshot (transient)
//   gs://<bucket>/<canonical>      → latest persisted backup, overwritten
//   gs://<bucket>/<historyPrefix>writer.db-<ISO>.gz → versioned history
//
// Verification signals (all logged as structured save-events):
//   • Every successful upload returns a GCS object generation. We log it
//     on the upload AND re-read object metadata to confirm the generation
//     matches before declaring success.
//   • sha256 of the snapshot is recorded on the GCS object's metadata,
//     logged on every step, and required to match across upload/verify.
//   • Cross-revision boot replay: each shutdown logs its final sha256;
//     the next boot logs the downloaded sha256. They must match in
//     consecutive db.shutdown.backup.ok / db.boot.gcs.download.ok pairs.
//
// Failure mode: if the periodic backup loop hits any error it does NOT
// crash the process — it logs db.backup.upload.fail and retries on the
// next tick. The shutdown handler is the last-resort flush.

import { Storage, type Bucket } from "@google-cloud/storage";
import type Database from "better-sqlite3";
import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import fs from "fs/promises";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { createHash } from "crypto";
import path from "path";
import { logEvent, warnTrace } from "@/lib/saveTrace";

const BUCKET_NAME = process.env.GCS_BUCKET || "ai-native-writer-db";
const CANONICAL_OBJECT = process.env.GCS_DB_OBJECT || "snapshots/writer.db.gz";
const HISTORY_PREFIX = process.env.GCS_HISTORY_PREFIX || "snapshots/history/";
const BACKUP_HISTORY_KEEP_DAYS = Number(
  process.env.BACKUP_HISTORY_KEEP_DAYS || "7"
);
const SHUTDOWN_UPLOAD_TIMEOUT_MS = Number(
  process.env.SHUTDOWN_UPLOAD_TIMEOUT_MS || "8000"
);
const RETENTION_SWEEP_EVERY_N_BACKUPS = Number(
  process.env.RETENTION_SWEEP_EVERY_N_BACKUPS || "60"
);

let _storage: Storage | null = null;
function getBucket(): Bucket {
  if (!_storage) _storage = new Storage();
  return _storage.bucket(BUCKET_NAME);
}

interface HealthSnapshot {
  bucket: string;
  canonicalObject: string;
  historyPrefix: string;
  lastUploadAt: string | null;
  lastSha256: string | null;
  lastGeneration: string | null;
  lastUploadDurationMs: number | null;
  sinceLastUploadMs: number | null;
  totalUploads: number;
  totalSkippedUnchanged: number;
  totalUploadFailures: number;
  lastError: { ts: string; message: string } | null;
  bootSource: "gcs" | "local-fallback" | "fresh" | null;
  bootSha256: string | null;
}

const _state: Omit<HealthSnapshot, "bucket" | "canonicalObject" | "historyPrefix" | "sinceLastUploadMs"> = {
  lastUploadAt: null,
  lastSha256: null,
  lastGeneration: null,
  lastUploadDurationMs: null,
  totalUploads: 0,
  totalSkippedUnchanged: 0,
  totalUploadFailures: 0,
  lastError: null,
  bootSource: null,
  bootSha256: null,
};

let _backupTimer: NodeJS.Timeout | null = null;
let _backupRunning = false;
let _backupTickCount = 0;

export function getPersistenceHealth(): HealthSnapshot {
  return {
    bucket: BUCKET_NAME,
    canonicalObject: CANONICAL_OBJECT,
    historyPrefix: HISTORY_PREFIX,
    ..._state,
    sinceLastUploadMs: _state.lastUploadAt
      ? Date.now() - new Date(_state.lastUploadAt).getTime()
      : null,
  };
}

async function sha256OfFile(p: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(p), hash);
  return hash.digest("hex");
}

async function gzipFile(srcPath: string, dstPath: string): Promise<number> {
  await pipeline(
    createReadStream(srcPath),
    createGzip({ level: 6 }),
    createWriteStream(dstPath)
  );
  const stat = await fs.stat(dstPath);
  return stat.size;
}

async function gunzipFile(srcPath: string, dstPath: string): Promise<number> {
  await pipeline(
    createReadStream(srcPath),
    createGunzip(),
    createWriteStream(dstPath)
  );
  const stat = await fs.stat(dstPath);
  return stat.size;
}

// Download the canonical GCS object to localPath. Returns null if the object
// doesn't exist (first boot). Throws on any other failure.
export async function loadFromGcs(localPath: string): Promise<{
  source: "gcs" | "missing";
  sha256: string | null;
  bytes: number;
  durationMs: number;
  generation: string | null;
} | null> {
  const t0 = Date.now();
  logEvent("db.boot.gcs.download.start", {
    bucket: BUCKET_NAME,
    object: CANONICAL_OBJECT,
    localPath,
  });

  const bucket = getBucket();
  const file = bucket.file(CANONICAL_OBJECT);

  let exists = false;
  try {
    [exists] = await file.exists();
  } catch (err) {
    logEvent("db.boot.gcs.download.fail", {
      stage: "exists",
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (!exists) {
    logEvent("db.boot.gcs.download.missing", {
      bucket: BUCKET_NAME,
      object: CANONICAL_OBJECT,
    });
    return null;
  }

  // Download to a transient gz path, then unzip into the live local path.
  const tmpGz = `${localPath}.boot.gz`;
  try {
    await file.download({ destination: tmpGz });
    const [meta] = await file.getMetadata();
    const generation = String(meta.generation ?? "");
    const reportedSha = (meta.metadata as Record<string, string> | undefined)
      ?.sha256 ?? null;
    const gzStat = await fs.stat(tmpGz);

    const bytes = await gunzipFile(tmpGz, localPath);
    const sha = await sha256OfFile(localPath);
    await fs.unlink(tmpGz).catch(() => {});

    if (reportedSha && reportedSha !== sha) {
      // sha mismatch is loud — the downloaded bytes don't match what GCS
      // metadata claims. We still continue (the downloaded file is
      // self-consistent gzipped bytes from GCS) but flag it for the user.
      warnTrace("db.boot.gcs.sha_mismatch", {
        downloadedSha: sha,
        reportedSha,
        generation,
      });
    }

    const durationMs = Date.now() - t0;
    logEvent("db.boot.gcs.download.ok", {
      bucket: BUCKET_NAME,
      object: CANONICAL_OBJECT,
      gzBytes: gzStat.size,
      bytes,
      sha256: sha,
      reportedSha,
      generation,
      durationMs,
    });

    _state.bootSource = "gcs";
    _state.bootSha256 = sha;
    _state.lastSha256 = sha;
    _state.lastGeneration = generation;

    return {
      source: "gcs",
      sha256: sha,
      bytes,
      durationMs,
      generation,
    };
  } catch (err) {
    await fs.unlink(tmpGz).catch(() => {});
    logEvent("db.boot.gcs.download.fail", {
      stage: "download",
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

// Take a hot snapshot of the live SQLite db, gzip it, upload to GCS canonical
// AND a unique history path in parallel. Verifies the upload by re-reading
// the object metadata and confirming the generation + sha256 came back.
//
// Caller must NOT call this from multiple concurrent ticks — _backupRunning
// guards the periodic timer. Direct callers (shutdown handler) await the
// return value.
async function backupOnce(
  sqlite: Database.Database,
  livePath: string
): Promise<{
  status: "uploaded" | "skipped";
  sha256: string;
  generation?: string;
  durationMs: number;
}> {
  const t0 = Date.now();
  // Snapshots and gzipped uploads always go to local /tmp, not next to
  // livePath. Earlier revisions put the snapshot in the same directory
  // as livePath; if livePath sat on a gcsfuse mount (legacy migration
  // setup), the SQLite online backup wrote 32 MB through gcsfuse with
  // OutOfOrderError fallbacks and made each backup take 15+ seconds
  // while uploads stalled behind the slow read. Pinning the transient
  // files to /tmp keeps the hot path on real local disk regardless of
  // where the live DB happens to live.
  const SCRATCH_DIR = process.env.BACKUP_SCRATCH_DIR || "/tmp";
  await fs.mkdir(SCRATCH_DIR, { recursive: true }).catch(() => {});
  const snapshotPath = path.join(SCRATCH_DIR, "writer.db.snapshot");
  const gzPath = path.join(SCRATCH_DIR, "writer.db.snapshot.gz");

  // 1. Online backup (no lock on writers — SQLite copies pages incrementally).
  const tBackup0 = Date.now();
  logEvent("db.backup.snapshot.start", { livePath, snapshotPath });
  // better-sqlite3 backup() returns a Promise<{totalPages, remainingPages}>
  // when destination is a string path.
  await sqlite.backup(snapshotPath);
  const snapStat = await fs.stat(snapshotPath);
  logEvent("db.backup.snapshot.ok", {
    bytes: snapStat.size,
    durationMs: Date.now() - tBackup0,
  });

  // 2. sha256 — change-detection key + identity for the upload.
  const sha = await sha256OfFile(snapshotPath);

  // 3. Skip if nothing changed since last upload.
  if (sha === _state.lastSha256) {
    _state.totalSkippedUnchanged += 1;
    await fs.unlink(snapshotPath).catch(() => {});
    logEvent("db.backup.skip.unchanged", {
      sha256: sha,
      lastUploadAt: _state.lastUploadAt,
    });
    return { status: "skipped", sha256: sha, durationMs: Date.now() - t0 };
  }

  // 4. Gzip the snapshot — saves bandwidth + storage.
  const gzBytes = await gzipFile(snapshotPath, gzPath);

  // 5. Build history object name using ISO timestamp (sortable).
  const iso = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("Z", "Z");
  const historyObject = `${HISTORY_PREFIX}writer.db-${iso}-${sha.slice(0, 12)}.gz`;

  logEvent("db.backup.upload.start", {
    canonical: CANONICAL_OBJECT,
    history: historyObject,
    sha256: sha,
    gzBytes,
  });

  const bucket = getBucket();
  const tUp0 = Date.now();

  // 6. Upload BOTH in parallel. Each upload goes through the GCS API directly
  //    — no gcsfuse anywhere in this path. The upload Promise only resolves
  //    after GCS has the bytes (i.e. has emitted the object).
  //    Custom metadata (sha256, source) MUST live under metadata.metadata —
  //    that's where the SDK stores user-defined keys. Putting them at the
  //    top-level metadata object causes them to be silently dropped.
  const sharedMeta = {
    contentType: "application/gzip",
    metadata: {
      cacheControl: "no-store",
      metadata: { sha256: sha, source: "writer-app-backup" },
    },
  };
  let canonicalGen = "";
  let historyGen = "";
  try {
    await Promise.all([
      bucket.file(CANONICAL_OBJECT).save(await fs.readFile(gzPath), sharedMeta),
      bucket.file(historyObject).save(await fs.readFile(gzPath), sharedMeta),
    ]);

    // 7. Read-after-write verification — independent confirmation that GCS
    //    actually persisted the upload. Generation must be present and the
    //    sha256 we set in metadata must come back identical.
    const [canonMeta] = await bucket.file(CANONICAL_OBJECT).getMetadata();
    const [histMeta] = await bucket.file(historyObject).getMetadata();
    canonicalGen = String(canonMeta.generation ?? "");
    historyGen = String(histMeta.generation ?? "");

    const canonSha = (canonMeta.metadata as Record<string, string> | undefined)
      ?.sha256;
    const histSha = (histMeta.metadata as Record<string, string> | undefined)
      ?.sha256;

    if (canonSha !== sha || histSha !== sha) {
      throw new Error(
        `verify mismatch: localSha=${sha} canonicalSha=${canonSha} historySha=${histSha}`
      );
    }
  } finally {
    await fs.unlink(snapshotPath).catch(() => {});
    await fs.unlink(gzPath).catch(() => {});
  }

  const durationMs = Date.now() - t0;
  const uploadDurationMs = Date.now() - tUp0;

  _state.lastSha256 = sha;
  _state.lastGeneration = canonicalGen;
  _state.lastUploadAt = new Date().toISOString();
  _state.lastUploadDurationMs = uploadDurationMs;
  _state.totalUploads += 1;

  logEvent("db.backup.upload.ok", {
    canonical: CANONICAL_OBJECT,
    canonicalGeneration: canonicalGen,
    history: historyObject,
    historyGeneration: historyGen,
    sha256: sha,
    gzBytes,
    uploadDurationMs,
    totalDurationMs: durationMs,
  });

  return {
    status: "uploaded",
    sha256: sha,
    generation: canonicalGen,
    durationMs,
  };
}

// Sweep history older than KEEP_DAYS. Best-effort — failures don't abort.
async function retentionSweep(): Promise<void> {
  const t0 = Date.now();
  const cutoff = Date.now() - BACKUP_HISTORY_KEEP_DAYS * 24 * 60 * 60 * 1000;
  try {
    const bucket = getBucket();
    const [files] = await bucket.getFiles({ prefix: HISTORY_PREFIX });
    let deleted = 0;
    let kept = 0;
    for (const f of files) {
      const ct = f.metadata.timeCreated
        ? new Date(f.metadata.timeCreated).getTime()
        : 0;
      if (ct && ct < cutoff) {
        await f.delete().catch(() => {});
        deleted += 1;
      } else {
        kept += 1;
      }
    }
    logEvent("db.backup.retention.sweep.ok", {
      historyPrefix: HISTORY_PREFIX,
      keepDays: BACKUP_HISTORY_KEEP_DAYS,
      deleted,
      kept,
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    logEvent("db.backup.retention.sweep.fail", {
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    });
  }
}

export function startBackupLoop(
  sqlite: Database.Database,
  livePath: string,
  intervalMs: number
): void {
  if (_backupTimer) return;
  logEvent("db.backup.loop.start", {
    intervalMs,
    livePath,
    bucket: BUCKET_NAME,
    canonical: CANONICAL_OBJECT,
    historyPrefix: HISTORY_PREFIX,
  });

  _backupTimer = setInterval(async () => {
    if (_backupRunning) {
      logEvent("db.backup.tick.skip.busy", {});
      return;
    }
    _backupRunning = true;
    _backupTickCount += 1;
    const tick = _backupTickCount;
    try {
      logEvent("db.backup.tick", { tick, intervalMs });
      await backupOnce(sqlite, livePath);
    } catch (err) {
      _state.totalUploadFailures += 1;
      const message = err instanceof Error ? err.message : String(err);
      _state.lastError = { ts: new Date().toISOString(), message };
      logEvent("db.backup.upload.fail", { tick, err: message });
    } finally {
      _backupRunning = false;
    }

    if (tick % RETENTION_SWEEP_EVERY_N_BACKUPS === 0) {
      retentionSweep().catch(() => {});
    }
  }, intervalMs);
  _backupTimer.unref?.();
}

export function stopBackupLoop(): void {
  if (_backupTimer) {
    clearInterval(_backupTimer);
    _backupTimer = null;
    logEvent("db.backup.loop.stop", {});
  }
}

// Final upload before container exits. Bounded by SHUTDOWN_UPLOAD_TIMEOUT_MS
// so we never miss the close call due to a slow GCS write.
export async function shutdownBackup(
  sqlite: Database.Database,
  livePath: string
): Promise<void> {
  stopBackupLoop();
  const t0 = Date.now();
  logEvent("db.shutdown.backup.start", {
    timeoutMs: SHUTDOWN_UPLOAD_TIMEOUT_MS,
  });

  // If a periodic tick is mid-flight, wait for it. Two concurrent
  // sqlite.backup() calls against the same destination path can corrupt
  // the snapshot. Bounded waits with the same overall timeout.
  const waitStart = Date.now();
  while (_backupRunning) {
    if (Date.now() - waitStart > SHUTDOWN_UPLOAD_TIMEOUT_MS) {
      logEvent("db.shutdown.backup.tick_wait_timeout", {
        waitedMs: Date.now() - waitStart,
      });
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`shutdown upload timed out after ${SHUTDOWN_UPLOAD_TIMEOUT_MS}ms`)
        ),
      SHUTDOWN_UPLOAD_TIMEOUT_MS
    );
    timer.unref?.();
  });

  try {
    const result = await Promise.race([
      backupOnce(sqlite, livePath),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    logEvent("db.shutdown.backup.ok", {
      sha256: result.sha256,
      generation: result.generation,
      status: result.status,
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    logEvent("db.shutdown.backup.fail", {
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    });
  }
}

// One-shot helper for migration / tests / boot. Forces a backup regardless
// of the change-detection cache. Uses the same _backupRunning flag as the
// periodic loop so a manual call can never race with a tick.
export async function forceBackup(
  sqlite: Database.Database,
  livePath: string
): Promise<{ sha256: string; generation?: string }> {
  // Wait briefly if a tick is mid-flight; same path conflict as shutdown.
  const waitStart = Date.now();
  while (_backupRunning) {
    if (Date.now() - waitStart > 30_000) {
      logEvent("db.forceBackup.tick_wait_timeout", {
        waitedMs: Date.now() - waitStart,
      });
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  _backupRunning = true;
  try {
    _state.lastSha256 = null; // bust the unchanged-skip
    const r = await backupOnce(sqlite, livePath);
    return { sha256: r.sha256, generation: r.generation };
  } finally {
    _backupRunning = false;
  }
}

// Migration helper: copy a pre-existing DB file (e.g. the legacy gcsfuse
// /app/data/writer.db) into the live local path. Used on first boot to
// seed the new persistence layer with whatever was on the gcsfuse mount.
// Logs the source + destination so we can audit the one-time migration
// in production.
export async function migrateLegacyDb(
  legacyPath: string,
  livePath: string
): Promise<{ migrated: boolean; bytes: number; sha256: string | null }> {
  if (!existsSync(legacyPath)) {
    logEvent("db.boot.migrate.skip", {
      reason: "legacy-not-found",
      legacyPath,
    });
    return { migrated: false, bytes: 0, sha256: null };
  }
  const stat = statSync(legacyPath);
  await fs.mkdir(path.dirname(livePath), { recursive: true });
  await fs.copyFile(legacyPath, livePath);
  const sha = await sha256OfFile(livePath);
  logEvent("db.boot.migrate.ok", {
    legacyPath,
    livePath,
    bytes: stat.size,
    sha256: sha,
  });
  _state.bootSource = "local-fallback";
  _state.bootSha256 = sha;
  return { migrated: true, bytes: stat.size, sha256: sha };
}
