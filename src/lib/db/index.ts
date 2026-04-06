import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";

type DB = ReturnType<typeof drizzle<typeof schema>>;

// Lazy singleton — DB is opened on first actual use, not at module evaluation.
// This prevents SQLITE_BUSY during `next build` (9 parallel workers evaluate
// every server module but never actually call any API handlers).
let _instance: DB | null = null;

export function getDb(): DB {
  if (!_instance) {
    const dbPath = path.join(process.cwd(), "data", "writer.db");
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    _instance = drizzle(sqlite, { schema });
    migrate(_instance, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  }
  return _instance;
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
