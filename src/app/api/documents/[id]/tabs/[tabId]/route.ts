import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { logTrace } from "@/lib/saveTrace";
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

// PATCH /api/documents/[id]/tabs/[tabId] — rename / change type / reorder.
// When the title changes, type + sequenceNumber are re-inferred from the new
// title so "My notes" → rename to "Episode 7" flips the tab into a
// reference_episode with seq=7 automatically. Callers can still pass an
// explicit type to override inference.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; tabId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, tabId } = await params;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    columns: { ownerId: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tab = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, tabId), eq(tabs.documentId, id)),
  });
  if (!tab) {
    return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  // Protected canonical tabs: reject title, type, sequenceNumber, and position
  // changes. Content updates pass through — writers still fill them in.
  const touchesStructure =
    typeof body.title === "string" ||
    typeof body.type === "string" ||
    typeof body.sequenceNumber === "number" ||
    body.sequenceNumber === null ||
    typeof body.position === "number";
  if (tab.isProtected && touchesStructure) {
    return NextResponse.json(
      {
        error:
          "This is a canonical tab (Original Research, Characters, Microdrama Plots, Predefined Episodes, or Workbook). Its title, type, and position are fixed — but you can still edit its contents.",
      },
      { status: 403 }
    );
  }

  let reInferred: ReturnType<typeof inferTabType> | null = null;
  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (t) {
      patch.title = t;
      reInferred = inferTabType(t);
    }
  }

  if (typeof body.type === "string") {
    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: "Invalid tab type" }, { status: 400 });
    }
    patch.type = body.type;
  } else if (reInferred) {
    // Auto-reclassify on rename.
    patch.type = reInferred.type;
  }

  if (typeof body.sequenceNumber === "number" || body.sequenceNumber === null) {
    patch.sequenceNumber = body.sequenceNumber;
  } else if (reInferred && reInferred.sequenceNumber != null) {
    patch.sequenceNumber = reInferred.sequenceNumber;
  }

  if (typeof body.position === "number") {
    patch.position = body.position;
  }

  await db
    .update(tabs)
    .set(patch)
    .where(and(eq(tabs.id, tabId), eq(tabs.documentId, id)));

  const updated = await db.query.tabs.findFirst({
    where: eq(tabs.id, tabId),
  });

  logTrace("tab.update.ok", {
    docId: id,
    tabId,
    patch: Object.keys(patch),
    userId: session.user.id,
  });

  return NextResponse.json(updated);
}

// DELETE /api/documents/[id]/tabs/[tabId]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; tabId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, tabId } = await params;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Block deletion of protected canonical tabs.
  const target = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, tabId), eq(tabs.documentId, id)),
    columns: { isProtected: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  }
  if (target.isProtected) {
    return NextResponse.json(
      {
        error:
          "Canonical tabs (Original Research, Characters, Microdrama Plots, Predefined Episodes, Workbook) cannot be deleted.",
      },
      { status: 403 }
    );
  }

  // Block deletion of the last remaining tab
  const siblings = await db
    .select({ id: tabs.id })
    .from(tabs)
    .where(eq(tabs.documentId, id));
  if (siblings.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the only tab in a document." },
      { status: 400 }
    );
  }

  await db
    .delete(tabs)
    .where(and(eq(tabs.id, tabId), eq(tabs.documentId, id)));

  // If the deleted tab was active, promote another tab
  if (doc.activeTabId === tabId) {
    const next = siblings.find((s) => s.id !== tabId);
    if (next) {
      await db
        .update(documents)
        .set({ activeTabId: next.id })
        .where(eq(documents.id, id));
    }
  }

  logTrace("tab.delete.ok", {
    docId: id,
    tabId,
    userId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
