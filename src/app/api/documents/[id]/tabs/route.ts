import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { and, eq, max, sql } from "drizzle-orm";
import { logTrace } from "@/lib/saveTrace";
import { inferTabType, type InferredTabType } from "@/lib/tab-type-inference";
import { splitTiptapDocument, shouldSplit } from "@/lib/split-doc";

const VALID_TYPES: readonly InferredTabType[] = [
  "custom",
  "series_overview",
  "characters",
  "episode_plot",
  "reference_episode",
  "research",
];

// Docs created via POST /api/documents before the "seed default Main tab on
// create" fix have zero tabs, so the doc page renders blank (no activeTabId →
// Editor never mounts). Heal idempotently on first GET: insert a Main tab
// identical to what migration 0002 seeds and point activeTabId at it.
async function healMissingDefaultTab(
  docId: string,
  docContent: string | null
): Promise<boolean> {
  const existing = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(tabs)
    .where(eq(tabs.documentId, docId));
  if ((existing[0]?.count ?? 0) > 0) return false;

  const tabId = nanoid(12);
  const now = new Date();
  await db.insert(tabs).values({
    id: tabId,
    documentId: docId,
    title: "Main",
    type: "custom",
    sequenceNumber: null,
    content: docContent,
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .update(documents)
    .set({ activeTabId: tabId, updatedAt: now })
    .where(eq(documents.id, docId));

  logTrace("tabs.heal.defaultMain", { docId, tabId });
  return true;
}

// On first tabs-fetch after migration 0002, a doc has exactly one "Main" tab
// holding all its pre-tab content. If that content has a canonical [H2]
// structure, split it into typed tabs in place, keeping the original as
// "Main (archive)" at position 0.
async function autoSplitIfNeeded(docId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(tabs)
    .where(eq(tabs.documentId, docId))
    .orderBy(tabs.position);

  if (rows.length !== 1) return false;
  const seed = rows[0];
  if (/\(archive\)/i.test(seed.title)) return false;
  if (!seed.content || !shouldSplit(seed.content)) return false;

  const sections = splitTiptapDocument(seed.content);
  if (sections.length === 0) return false;

  const now = new Date();
  // 1. Demote seed to "Main (archive)" at position 0.
  await db
    .update(tabs)
    .set({
      title: /\(archive\)/i.test(seed.title) ? seed.title : `${seed.title} (archive)`,
      position: 0,
      updatedAt: now,
    })
    .where(eq(tabs.id, seed.id));

  // 2. Insert new typed tabs at positions 1..N.
  let firstNewId: string | null = null;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const newId = nanoid(12);
    if (firstNewId === null) firstNewId = newId;
    await db.insert(tabs).values({
      id: newId,
      documentId: docId,
      title: s.title,
      type: s.type,
      sequenceNumber: s.sequenceNumber,
      content: s.content,
      position: i + 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 3. First typed tab becomes the active tab.
  if (firstNewId) {
    await db
      .update(documents)
      .set({ activeTabId: firstNewId })
      .where(eq(documents.id, docId));
  }

  logTrace("tabs.autosplit.ok", {
    docId,
    sections: sections.length,
  });

  return true;
}

// GET /api/documents/[id]/tabs
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    columns: { id: true, ownerId: true, content: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Heal docs that were created without a default Main tab (regression from
  // tabs PR — POST /api/documents didn't seed one). Runs before auto-split
  // so a healed doc with canonical structure still gets split on next open.
  await healMissingDefaultTab(id, doc.content);

  // Lazy auto-split on first real fetch. Only runs when the doc is still a
  // single-Main-tab state + the Main content has splittable structure.
  // Idempotent: later fetches find >1 tab and skip.
  await autoSplitIfNeeded(id);

  const rows = await db
    .select()
    .from(tabs)
    .where(eq(tabs.documentId, id))
    .orderBy(tabs.position);

  return NextResponse.json(rows);
}

// POST /api/documents/[id]/tabs — create a new tab.
// Writer provides just a title; type + sequenceNumber are inferred from it.
// Callers (e.g. the split script) can still pass an explicit type / sequenceNumber.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const title: string = body.title?.toString().trim() || "Untitled";

  // Infer from title; caller can override with an explicit type.
  const inferred = inferTabType(title);
  const type: InferredTabType =
    body.type && VALID_TYPES.includes(body.type) ? body.type : inferred.type;

  // Sequence number: explicit override > inferred (for reference_episode) >
  // auto-increment max+1 for reference_episode > null.
  let sequenceNumber: number | null = null;
  if (typeof body.sequenceNumber === "number") {
    sequenceNumber = body.sequenceNumber;
  } else if (inferred.sequenceNumber != null && type === "reference_episode") {
    sequenceNumber = inferred.sequenceNumber;
  } else if (type === "reference_episode") {
    const maxRow = await db
      .select({ max: max(tabs.sequenceNumber) })
      .from(tabs)
      .where(and(eq(tabs.documentId, id), eq(tabs.type, "reference_episode")));
    sequenceNumber = (maxRow[0]?.max ?? 0) + 1;
  }

  // Position = end of list
  const maxPos = await db
    .select({ max: max(tabs.position) })
    .from(tabs)
    .where(eq(tabs.documentId, id));
  const position = (maxPos[0]?.max ?? -1) + 1;

  const tabId = nanoid(12);
  const now = new Date();
  await db.insert(tabs).values({
    id: tabId,
    documentId: id,
    title,
    type,
    sequenceNumber,
    content: body.content ?? null,
    position,
    createdAt: now,
    updatedAt: now,
  });

  logTrace("tab.create.ok", {
    docId: id,
    tabId,
    type,
    sequenceNumber,
    userId: session.user.id,
    inferredFromTitle: !body.type,
  });

  return NextResponse.json({
    id: tabId,
    documentId: id,
    title,
    type,
    sequenceNumber,
    content: body.content ?? null,
    position,
    createdAt: now,
    updatedAt: now,
  });
}
