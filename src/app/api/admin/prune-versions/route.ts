// TEMPORARY admin route — one-time prune of document_versions down to the
// new retention rule (newest 10 + daily IST anchor) per (doc, tab), then
// VACUUM + GCS backup. Delete this file after running once in prod.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, forceBackupNow } from "@/lib/db";
import { documentVersions } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const LIMIT = 10;

function startOfTodayIST(): Date {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = Date.now() + IST_OFFSET_MS;
  const istMidnight = Math.floor(nowIst / 86_400_000) * 86_400_000;
  return new Date(istMidnight - IST_OFFSET_MS);
}

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Get all distinct (documentId, tabId) pairs that have versions.
  const pairs = await db
    .select({
      documentId: documentVersions.documentId,
      tabId: documentVersions.tabId,
    })
    .from(documentVersions)
    .groupBy(documentVersions.documentId, documentVersions.tabId);

  let totalDeleted = 0;
  const startOfToday = startOfTodayIST();

  for (const p of pairs) {
    // Skip legacy null-tabId rows — these predate the tab system.
    // They will not be deleted; a separate decision is needed for them.
    if (!p.tabId) continue;

    const rows = await db
      .select({
        id: documentVersions.id,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, p.documentId),
          eq(documentVersions.tabId, p.tabId)
        )
      )
      .orderBy(desc(documentVersions.createdAt));

    if (rows.length <= LIMIT) continue;

    const keep = new Set<string>(rows.slice(0, LIMIT).map((r) => r.id));
    const anchor = rows.find((r) => r.createdAt < startOfToday);
    if (anchor) keep.add(anchor.id);

    const toDelete = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (toDelete.length === 0) continue;

    // Chunk to stay under SQLite's variable limit (~32766 params).
    for (let i = 0; i < toDelete.length; i += 400) {
      const chunk = toDelete.slice(i, i + 400);
      await db.delete(documentVersions).where(
        and(
          eq(documentVersions.documentId, p.documentId),
          eq(documentVersions.tabId, p.tabId),
          inArray(documentVersions.id, chunk)
        )
      );
      totalDeleted += chunk.length;
    }
  }

  // 2. Reclaim freed pages. VACUUM rebuilds the DB file; run off-peak.
  await db.run(sql`VACUUM`);

  // 3. Push the shrunk DB to GCS now instead of waiting for the next tick.
  await forceBackupNow();

  return NextResponse.json({ ok: true, pairs: pairs.length, totalDeleted });
}
