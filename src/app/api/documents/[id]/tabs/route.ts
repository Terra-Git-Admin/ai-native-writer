import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { and, eq, max } from "drizzle-orm";
import { logEvent, logTrace } from "@/lib/saveTrace";
import { inferTabType, type InferredTabType } from "@/lib/tab-type-inference";

const VALID_TYPES: readonly string[] = [
  "custom",
  "series_overview",
  "characters",
  "series_skeleton",
  "episode_plot",
  "reference_episode",
  "research",
  "microdrama_plots",
  "predefined_episodes",
  "workbook",
];

// GET /api/documents/[id]/tabs
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const t0 = Date.now();
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    columns: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tReadStart = Date.now();
  const rows = await db
    .select()
    .from(tabs)
    .where(eq(tabs.documentId, id))
    .orderBy(tabs.position);
  const msFinalRead = Date.now() - tReadStart;

  const tabCount = rows.length;
  const totalContentBytes = rows.reduce(
    (s, r) => s + (r.content?.length ?? 0),
    0
  );

  logEvent("tabs.get.timing", {
    phase: "heal-skip",
    docId: id,
    tabCount,
    totalContentBytes,
    healRan: false,
    msHeals: 0,
    msFinalRead,
    msTotal: Date.now() - t0,
  });

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

  // Sequence number: explicit override > inferred (for predefined_episodes) >
  // auto-increment max+1 for predefined_episodes > null.
  let sequenceNumber: number | null = null;
  if (typeof body.sequenceNumber === "number") {
    sequenceNumber = body.sequenceNumber;
  } else if (inferred.sequenceNumber != null && type === "predefined_episodes") {
    sequenceNumber = inferred.sequenceNumber;
  } else if (type === "predefined_episodes") {
    const maxRow = await db
      .select({ max: max(tabs.sequenceNumber) })
      .from(tabs)
      .where(and(eq(tabs.documentId, id), eq(tabs.type, "predefined_episodes")));
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
