import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPersistenceHealth } from "@/lib/db/persistence";
import { dbFileStats, getDbPath } from "@/lib/db";

// GET /api/admin/persistence/health — returns durability state.
//
// Use this to verify the GCS-direct backup is actually landing bytes:
//   curl ${BASE}/api/admin/persistence/health
//
// Watch lastUploadAt advance and lastGeneration increment over time. If
// sinceLastUploadMs creeps past 2 × BACKUP_INTERVAL_MS, something is
// blocking the loop and you should grep Cloud Run for db.backup.upload.fail.
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const persistence = getPersistenceHealth();
  const file = dbFileStats();
  const dbPath = getDbPath();

  return NextResponse.json({
    persistence,
    db: {
      path: dbPath,
      ...file,
      walMtimeISO: file.walMtime ? new Date(file.walMtime).toISOString() : null,
      dbMtimeISO: file.dbMtime ? new Date(file.dbMtime).toISOString() : null,
    },
    env: {
      DATABASE_PATH: process.env.DATABASE_PATH ?? null,
      GCS_BUCKET: process.env.GCS_BUCKET ?? null,
      GCS_DB_OBJECT: process.env.GCS_DB_OBJECT ?? null,
      GCS_HISTORY_PREFIX: process.env.GCS_HISTORY_PREFIX ?? null,
      BACKUP_INTERVAL_MS: process.env.BACKUP_INTERVAL_MS ?? null,
      BACKUP_HISTORY_KEEP_DAYS: process.env.BACKUP_HISTORY_KEEP_DAYS ?? null,
    },
    serverNow: new Date().toISOString(),
  });
}
