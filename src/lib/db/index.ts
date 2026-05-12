import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { logEvent } from "@/lib/saveTrace";
import { startBackupLoop, shutdownBackup, forceBackup } from "./persistence";

type DB = ReturnType<typeof drizzle<typeof schema>>;

// Storage architecture (post fix/gcs-direct-durability):
//
//   Live SQLite file   →  /tmp/writer.db  (Cloud Run local disk, REAL fs)
//   Persisted backup   →  gs://<bucket>/<canonical>.gz  (GCS, direct API)
//   Versioned history  →  gs://<bucket>/<historyPrefix>/writer.db-<ISO>.gz
//
// The previous setup wrote SQLite onto a gcsfuse-mounted directory. gcsfuse
// buffered the writer.db file write-handle in memory and did NOT flush to
// GCS on either fsync or wal_checkpoint — bytes only left the container
// at file close, and Cloud Run's 10 second SIGTERM grace was not enough
// to flush a 32 MB write through gcsfuse.
//
// New flow: SQLite writes to /tmp at full speed. Every BACKUP_INTERVAL_MS,
// we take an online (hot) backup, gzip it, upload directly via the
// @google-cloud/storage SDK. The upload Promise only resolves after GCS
// returns a generation; we re-read object metadata as proof. The SIGTERM
// handler awaits a final upload before close.
//
// The initial GCS → /tmp download happens in scripts/db-bootstrap.mjs
// before Node starts the HTTP server (see Dockerfile CMD). That keeps
// the runtime db getter synchronous and the first request fast.
//
// See src/lib/db/persistence.ts for the GCS path implementation and
// the structured log events you can grep for in Cloud Run.

let _instance: DB | null = null;
let _sqlite: Database.Database | null = null;
let _dbPath: string | null = null;
let _shutdownRegistered = false;

const BACKUP_INTERVAL_MS = Number(process.env.BACKUP_INTERVAL_MS || "60000");
const GCS_BACKUP_ENABLED = Boolean(process.env.GCS_BUCKET);

function fileStats(p: string): { size: number; mtime: number } | null {
  try {
    const s = fs.statSync(p);
    return { size: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
}

function hardenDurability(sqlite: Database.Database): void {
  // synchronous=FULL → fsync on every commit. Now that the underlying file
  // is on real container disk (not gcsfuse), fsync is meaningful.
  sqlite.pragma("synchronous = FULL");
}

function registerGracefulShutdown(
  sqlite: Database.Database,
  livePath: string
): void {
  if (_shutdownRegistered) return;
  _shutdownRegistered = true;
  let shutdownRan = false;

  const shutdown = async (signal: string) => {
    if (shutdownRan) return;
    shutdownRan = true;
    logEvent("db.shutdown.start", { signal });

    // 1. Final GCS upload — the entire point of this rewrite. The next
    //    container boots from GCS so the bytes MUST be there. Bounded
    //    by SHUTDOWN_UPLOAD_TIMEOUT_MS so a slow upload doesn't eat the
    //    close call.
    if (GCS_BACKUP_ENABLED) {
      try {
        await shutdownBackup(sqlite, livePath);
      } catch (err) {
        logEvent("db.shutdown.backup.unhandled", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Final WAL checkpoint + close.
    const t1 = Date.now();
    try {
      const result = sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<{
        busy: number;
        log: number;
        checkpointed: number;
      }>;
      const r = result[0] ?? { busy: -1, log: -1, checkpointed: -1 };
      logEvent("db.shutdown.checkpoint.ok", {
        busy: r.busy,
        log: r.log,
        checkpointed: r.checkpointed,
        elapsedMs: Date.now() - t1,
      });
    } catch (err) {
      logEvent("db.shutdown.checkpoint.fail", {
        err: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - t1,
      });
    }

    const t2 = Date.now();
    try {
      sqlite.close();
      logEvent("db.shutdown.close.ok", { elapsedMs: Date.now() - t2 });
    } catch (err) {
      logEvent("db.shutdown.close.fail", {
        err: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - t2,
      });
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("beforeExit", () => {
    void shutdown("beforeExit");
  });
}

export function getDb(): DB {
  if (!_instance) {
    const dbPath =
      process.env.DATABASE_PATH || path.join(process.cwd(), "data", "writer.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    hardenDurability(sqlite);
    _sqlite = sqlite;
    _dbPath = dbPath;
    _instance = drizzle(sqlite, { schema });
    migrate(_instance, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    // Defensive guard: if migration 0006 was recorded as applied in
    // __drizzle_migrations but the ALTER TABLE never ran (e.g. DB restored
    // from a backup taken after the journal entry was written but before the
    // column was physically added), add the column now. Idempotent.
    const cols = sqlite.pragma("table_info(ai_jobs)") as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "user_guidance")) {
      sqlite.exec("ALTER TABLE `ai_jobs` ADD `user_guidance` text");
      logEvent("db.migration.defensive.user_guidance_added", {});
    }

    const db = fileStats(dbPath);
    const wal = fileStats(`${dbPath}-wal`);
    logEvent("db.open", {
      pid: process.pid,
      dbPath,
      gcsBackupEnabled: GCS_BACKUP_ENABLED,
      backupIntervalMs: BACKUP_INTERVAL_MS,
      journal_mode: sqlite.pragma("journal_mode", { simple: true }),
      synchronous: sqlite.pragma("synchronous", { simple: true }),
      walAutocheckpoint: sqlite.pragma("wal_autocheckpoint", { simple: true }),
      pageSize: sqlite.pragma("page_size", { simple: true }),
      dbSize: db?.size ?? null,
      walSize: wal?.size ?? null,
    });

    if (GCS_BACKUP_ENABLED) {
      // Fire one backup right away so a fresh boot's state lands in GCS
      // before the container can be killed. Without this, a cold container
      // could die in the first BACKUP_INTERVAL_MS without ever pushing.
      // Best-effort — failures here are logged and the loop will retry.
      forceBackup(sqlite, dbPath).catch((err) => {
        logEvent("db.boot.initial_backup.fail", {
          err: err instanceof Error ? err.message : String(err),
        });
      });
      startBackupLoop(sqlite, dbPath, BACKUP_INTERVAL_MS);
    } else {
      logEvent("db.backup.disabled", {
        reason: "GCS_BUCKET env var not set",
      });
    }

    registerGracefulShutdown(sqlite, dbPath);
  }
  return _instance;
}

export function getDbPath(): string | null {
  return _dbPath;
}

export function dbFileStats(): {
  dbSize: number | null;
  walSize: number | null;
  dbMtime: number | null;
  walMtime: number | null;
} {
  if (!_dbPath)
    return { dbSize: null, walSize: null, dbMtime: null, walMtime: null };
  const db = fileStats(_dbPath);
  const wal = fileStats(`${_dbPath}-wal`);
  return {
    dbSize: db?.size ?? null,
    walSize: wal?.size ?? null,
    dbMtime: db?.mtime ?? null,
    walMtime: wal?.mtime ?? null,
  };
}

// Proxy gives Turbopack a static `export const db` while deferring all
// actual DB work until runtime property access. Auth.ts uses getDb()
// directly because DrizzleAdapter does instanceof checks Proxy can't
// satisfy.
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});
