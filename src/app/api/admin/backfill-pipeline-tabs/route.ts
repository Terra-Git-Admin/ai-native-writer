// One-time admin route — inserts the 3 new pipeline canonical tabs
// (world_state, beat_sequence, story_logic) into any existing doc that
// doesn't have them yet. Reuses healFixedTabs which is idempotent.
// Run once after the first deploy of feat/multi-step-episode-pipeline.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { healFixedTabs } from "@/lib/tab-heal";
import { logEvent, logTrace } from "@/lib/saveTrace";

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allDocs = await db.select({ id: documents.id }).from(documents);

  let docsProcessed = 0;
  let docsChanged = 0;

  for (const doc of allDocs) {
    const changed = await healFixedTabs(doc.id);
    logTrace("backfill.pipeline_tabs.doc", { docId: doc.id, changed });
    docsProcessed++;
    if (changed) docsChanged++;
  }

  logEvent("backfill.pipeline_tabs.done", { docsProcessed, docsChanged });
  return NextResponse.json({ ok: true, docsProcessed, docsChanged });
}
