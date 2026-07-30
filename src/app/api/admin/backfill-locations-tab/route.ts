// One-time admin route — inserts the Locations canonical tab into specific
// docs that existed before CANONICAL_TABS_VERSION 2. Pass docIds in the body.
// Reuses insertMissingCanonicalTabs — idempotent, insert-only.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { insertMissingCanonicalTabs } from "@/lib/backfill-canonical-tabs";
import { logEvent } from "@/lib/saveTrace";

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const docIds: string[] = Array.isArray(body.docIds) ? body.docIds : [];

  if (docIds.length === 0) {
    return NextResponse.json({ error: "docIds required" }, { status: 400 });
  }

  const results: Record<string, { inserted: string[]; repositioned: number } | { error: string }> = {};
  const dbi = getDb();

  for (const docId of docIds) {
    const doc = await dbi.select({ id: documents.id }).from(documents).where(eq(documents.id, docId)).get();
    if (!doc) {
      results[docId] = { error: "not found" };
      continue;
    }
    const result = dbi.transaction((tx) => insertMissingCanonicalTabs(tx, docId));
    results[docId] = result;
  }

  logEvent("admin.backfill_locations_tab.done", { docIds, results });
  return NextResponse.json({ ok: true, results });
}
