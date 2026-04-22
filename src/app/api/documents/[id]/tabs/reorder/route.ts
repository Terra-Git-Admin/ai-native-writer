import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { logTrace } from "@/lib/saveTrace";

// PUT /api/documents/[id]/tabs/reorder
// Body: { order: string[] }  — tab IDs in the new display order.
// Each tab's position is set to its index in the array. Tabs not mentioned
// keep their existing position (caller should send all of them for a clean
// result).
export async function PUT(
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
    columns: { ownerId: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const order: unknown = body.order;
  if (!Array.isArray(order) || order.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "order must be an array of tab IDs" }, { status: 400 });
  }

  const now = new Date();
  const tx = (order as string[]).map((tabId, idx) =>
    db
      .update(tabs)
      .set({ position: idx, updatedAt: now })
      .where(and(eq(tabs.id, tabId), eq(tabs.documentId, id)))
  );

  // Drizzle/better-sqlite3 doesn't expose a transaction wrapper from the ORM
  // layer in all paths, but sequential awaits are fine here — positions are
  // commutative and the set is small.
  for (const p of tx) await p;

  logTrace("tabs.reorder.ok", {
    docId: id,
    count: (order as string[]).length,
    userId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
