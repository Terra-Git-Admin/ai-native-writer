#!/usr/bin/env node
// Container startup bootstrap. Runs BEFORE the Next.js server starts.
// Purpose: get the canonical writer.db onto local /tmp before the app
// opens it. Bypasses gcsfuse entirely — talks directly to GCS.
//
// Order of operations:
//   1. If DATABASE_PATH already exists locally → skip (warm restart).
//   2. Try GCS download from gs://<GCS_BUCKET>/<GCS_DB_OBJECT>.
//   3. If GCS object missing AND legacy gcsfuse path has a writer.db →
//      copy it as a one-time migration seed.
//   4. Otherwise leave the path empty so SQLite creates a fresh db.
//
// Logs every step with a [bootstrap] prefix so Cloud Run filters can
// isolate startup events.
//
// Env vars:
//   DATABASE_PATH       (default: /tmp/writer.db)
//   GCS_BUCKET          (default: ai-native-writer-db)
//   GCS_DB_OBJECT       (default: snapshots/writer.db.gz)
//   LEGACY_DB_PATH      (default: /app/data/writer.db) — gcsfuse mount
//   BOOTSTRAP_REQUIRED  (default: false) — if "true", exit non-zero
//                        when GCS download fails AND legacy is missing.
//                        Use this once we've cut over fully to ensure
//                        we never silently start with a fresh empty db.

import { Storage } from "@google-cloud/storage";
import { createReadStream, createWriteStream, existsSync } from "fs";
import { mkdir, stat, copyFile, unlink } from "fs/promises";
import { dirname } from "path";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";

const DATABASE_PATH = process.env.DATABASE_PATH || "/tmp/writer.db";
const GCS_BUCKET = process.env.GCS_BUCKET || "ai-native-writer-db";
const GCS_DB_OBJECT = process.env.GCS_DB_OBJECT || "snapshots/writer.db.gz";
const LEGACY_DB_PATH = process.env.LEGACY_DB_PATH || "/app/data/writer.db";
const BOOTSTRAP_REQUIRED = process.env.BOOTSTRAP_REQUIRED === "true";

function log(event, fields = {}) {
  console.log(
    "[bootstrap] " +
      JSON.stringify({ event, ts: new Date().toISOString(), ...fields })
  );
}

async function main() {
  log("start", {
    databasePath: DATABASE_PATH,
    gcsBucket: GCS_BUCKET,
    gcsObject: GCS_DB_OBJECT,
    legacyPath: LEGACY_DB_PATH,
    required: BOOTSTRAP_REQUIRED,
  });

  await mkdir(dirname(DATABASE_PATH), { recursive: true });

  if (existsSync(DATABASE_PATH)) {
    const s = await stat(DATABASE_PATH);
    log("local.exists", {
      path: DATABASE_PATH,
      bytes: s.size,
      mtime: s.mtimeMs,
    });
    log("done", { source: "local-warm" });
    return;
  }

  // Try GCS first.
  let gcsResult = await tryGcsDownload();

  if (gcsResult.ok) {
    log("done", { source: "gcs", ...gcsResult });
    return;
  }

  log("gcs.unavailable", { reason: gcsResult.reason });

  // Legacy migration fallback.
  if (existsSync(LEGACY_DB_PATH)) {
    const t0 = Date.now();
    await copyFile(LEGACY_DB_PATH, DATABASE_PATH);
    const s = await stat(DATABASE_PATH);
    log("legacy.copied", {
      from: LEGACY_DB_PATH,
      to: DATABASE_PATH,
      bytes: s.size,
      durationMs: Date.now() - t0,
    });
    log("done", { source: "legacy-migration" });
    return;
  }

  if (BOOTSTRAP_REQUIRED) {
    log("fatal", {
      reason: "no GCS object, no legacy path, BOOTSTRAP_REQUIRED=true",
    });
    process.exit(1);
  }

  log("done", { source: "fresh" });
}

async function tryGcsDownload() {
  const t0 = Date.now();
  try {
    const storage = new Storage();
    const bucket = storage.bucket(GCS_BUCKET);
    const file = bucket.file(GCS_DB_OBJECT);

    const [exists] = await file.exists();
    if (!exists) {
      return { ok: false, reason: "object-not-found" };
    }

    const tmpGz = `${DATABASE_PATH}.boot.gz`;
    await file.download({ destination: tmpGz });
    const [meta] = await file.getMetadata();
    const gzStat = await stat(tmpGz);

    await pipeline(
      createReadStream(tmpGz),
      createGunzip(),
      createWriteStream(DATABASE_PATH)
    );
    const finalStat = await stat(DATABASE_PATH);

    await unlink(tmpGz).catch(() => {});

    log("gcs.download.ok", {
      bucket: GCS_BUCKET,
      object: GCS_DB_OBJECT,
      generation: String(meta.generation ?? ""),
      metageneration: String(meta.metageneration ?? ""),
      reportedSha:
        (meta.metadata && meta.metadata.sha256) || null,
      gzBytes: gzStat.size,
      bytes: finalStat.size,
      durationMs: Date.now() - t0,
    });
    return {
      ok: true,
      generation: String(meta.generation ?? ""),
      bytes: finalStat.size,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    log("gcs.download.fail", {
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    });
    return { ok: false, reason: "exception" };
  }
}

main().catch((err) => {
  log("uncaught", {
    err: err instanceof Error ? err.message : String(err),
  });
  // Don't fail the container on bootstrap exceptions unless required —
  // the app will start fresh, which is recoverable, vs. infinite restart loop.
  if (BOOTSTRAP_REQUIRED) process.exit(1);
});
