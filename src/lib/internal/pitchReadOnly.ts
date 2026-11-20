import Database from "better-sqlite3";
import { timingSafeEqual } from "crypto";
import path from "path";

/**
 * Read-only access for server-to-server callers (e.g. the comics-dash backend's Meeting Record
 * "Pitches" tab). Deliberately NOT the app's shared `db`: that handle runs migrations and the
 * backup loop. This one is a separate connection opened `readonly` with `query_only` on, so no
 * statement issued through it can modify writer.db. Do not add write statements here.
 */

let _ro: Database.Database | null = null;

export function getReadOnlyDb(): Database.Database {
  if (_ro) return _ro;
  const dbPath =
    process.env.DATABASE_PATH || path.join(process.cwd(), "data", "writer.db");
  const conn = new Database(dbPath, { readonly: true, fileMustExist: true });
  conn.pragma("query_only = ON");
  conn.pragma("busy_timeout = 3000");
  _ro = conn;
  return conn;
}

export type TokenCheck = { ok: true } | { ok: false; status: 401 | 503; error: string };

/** `Authorization: Bearer <PITCH_READ_TOKEN>`. The route is disabled (503) when the env is unset. */
export function checkPitchReadToken(req: Request): TokenCheck {
  const expected = process.env.PITCH_READ_TOKEN;
  if (!expected) {
    return { ok: false, status: 503, error: "Pitch read API is not configured" };
  }
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
