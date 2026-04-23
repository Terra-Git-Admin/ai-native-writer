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

  // Enforce protected canonical tabs stay at their fixed positions. Fetch
  // current state and reject any proposed order that would move a protected
  // tab out of its original slot. Protected tabs sort by current position
  // (seeded to 0..4 by canonical-tabs.ts) and must occupy the leading slots
  // in the incoming order.
  const currentRows = await db
    .select({
      id: tabs.id,
      position: tabs.position,
      isProtected: tabs.isProtected,
    })
    .from(tabs)
    .where(eq(tabs.documentId, id));
  const expectedProtectedIds = currentRows
    .filter((r) => r.isProtected)
    .sort((a, b) => a.position - b.position)
    .map((r) => r.id);
  const incomingOrder = order as string[];
  for (let i = 0; i < expectedProtectedIds.length; i++) {
    if (incomingOrder[i] !== expectedProtectedIds[i]) {
      return NextResponse.json(
        {
          error:
            "Protected canonical tabs cannot be reordered. They must stay in their fixed positions at the top.",
        },
        { status: 403 }
      );
    }
  }

  const now = new Date();
  const tx = incomingOrder.map((tabId, idx) =>
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
    count: incomingOrder.length,
    userId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
