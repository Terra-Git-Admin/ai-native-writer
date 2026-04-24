import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { logEvent } from "@/lib/saveTrace";

type DB = ReturnType<typeof drizzle<typeof schema>>;

// Lazy singleton — DB is opened on first actual use, not at module evaluation.
// This prevents SQLITE_BUSY during `next build` (9 parallel workers evaluate
// every server module but never actually call any API handlers).
let _instance: DB | null = null;
let _sqlite: Database.Database | null = null;
let _dbPath: string | null = null;
let _checkpointTimer: NodeJS.Timeout | null = null;
let _shutdownRegistered = false;

// Durability hardening for the SQLite-on-gcsfuse setup. gcsfuse buffers writes
// locally and uploads to Cloud Storage on file close or its own schedule — not
// on fsync. Container kill at deploy time can evaporate writes that SQLite
// ack'd. This patch narrows the loss window; it does NOT make the setup fully
// durable. Migration off gcsfuse (Turso / Cloud SQL) is the permanent fix.
function hardenDurability(sqlite: Database.Database): void {
  // synchronous=FULL → fsync on every commit, not just at checkpoint boundaries.
  sqlite.pragma("synchronous = FULL");
}

// File stats for observability — never throw.
function fileStats(p: string): { size: number; mtime: number } | null {
  try {
    const s = fs.statSync(p);
    return { size: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
}

function schedulePeriodicCheckpoint(sqlite: Database.Database, dbPath: string): void {
  if (_checkpointTimer) return;
  // Every 60s, merge WAL into main DB. Keeps the at-risk window bounded and
  // rotates the underlying file so gcsfuse's upload scheduler sees movement.
  _checkpointTimer = setInterval(() => {
    try {
      // Drizzle's sqlite.pragma returns the raw result rows. For
      // wal_checkpoint this is an array with [busy, log, checkpointed].
      const result = sqlite.pragma("wal_checkpoint(PASSIVE)") as Array<{
        busy: number;
        log: number;
        checkpointed: number;
      }>;
      const r = result[0] ?? { busy: -1, log: -1, checkpointed: -1 };
      const db = fileStats(dbPath);
      const wal = fileStats(`${dbPath}-wal`);
      logEvent("db.checkpoint.tick", {
        busy: r.busy,
        log: r.log,
        checkpointed: r.checkpointed,
        dbSize: db?.size ?? null,
        walSize: wal?.size ?? null,
      });
    } catch (err) {
      // Best-effort — checkpoint failures are non-fatal and will retry next tick.
      logEvent("db.checkpoint.tick.fail", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, 60_000);
  // Don't keep the event loop alive just for the checkpoint timer.
  _checkpointTimer.unref?.();
}

function registerGracefulShutdown(sqlite: Database.Database): void {
  if (_shutdownRegistered) return;
  _shutdownRegistered = true;
  let shutdownRan = false;
  const shutdown = (signal: string) => {
    if (shutdownRan) return;
    shutdownRan = true;
    logEvent("db.shutdown.start", { signal });
    if (_checkpointTimer) {
      clearInterval(_checkpointTimer);
      _checkpointTimer = null;
    }
    // Final checkpoint: TRUNCATE merges WAL into main DB and zeros the WAL
    // file. Main-DB write that follows is our last chance for gcsfuse to
    // upload before SIGKILL.
    const t0 = Date.now();
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
        elapsedMs: Date.now() - t0,
      });
    } catch (err) {
      logEvent("db.shutdown.checkpoint.fail", {
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - t0,
      });
    }
    const t1 = Date.now();
    try {
      sqlite.close();
      logEvent("db.shutdown.close.ok", { elapsedMs: Date.now() - t1 });
    } catch (err) {
      logEvent("db.shutdown.close.fail", {
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - t1,
      });
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("beforeExit", () => shutdown("beforeExit"));
}

export function getDb(): DB {
  if (!_instance) {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "writer.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    hardenDurability(sqlite);
    _sqlite = sqlite;
    _dbPath = dbPath;
    _instance = drizzle(sqlite, { schema });
    migrate(_instance, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const db = fileStats(dbPath);
    const wal = fileStats(`${dbPath}-wal`);
    logEvent("db.open", {
      pid: process.pid,
      journal_mode: sqlite.pragma("journal_mode", { simple: true }),
      synchronous: sqlite.pragma("synchronous", { simple: true }),
      walAutocheckpoint: sqlite.pragma("wal_autocheckpoint", { simple: true }),
      pageSize: sqlite.pragma("page_size", { simple: true }),
      dbSize: db?.size ?? null,
      walSize: wal?.size ?? null,
    });
    schedulePeriodicCheckpoint(sqlite, dbPath);
    registerGracefulShutdown(sqlite);
  }
  return _instance;
}

// Exposed for observability code that wants to include on-disk state in
// per-request log events (e.g., tab.put.fingerprint, tab.version.fingerprint).
export function getDbPath(): string | null {
  return _dbPath;
}

export function dbFileStats(): {
  dbSize: number | null;
  walSize: number | null;
  dbMtime: number | null;
  walMtime: number | null;
} {
  if (!_dbPath) return { dbSize: null, walSize: null, dbMtime: null, walMtime: null };
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
// actual DB work until runtime property access (db.query, db.select, etc.).
// NOTE: Do not pass `db` to DrizzleAdapter — it does instanceof checks that
// Proxy can't satisfy. Use getDb() for that (see auth.ts).
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});
