import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, documentVersions } from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

// GET /api/documents/[id]
export async function GET(
  _req: Request,
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

  return NextResponse.json({
    ...doc,
    isOwner: doc.ownerId === session.user.id,
  });
}

// PUT /api/documents/[id] — update document
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
  });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();

  // Only owner can update title or general content
  // Any authenticated user can update content if commentMarkOnly (for adding comment highlights)
  if (doc.ownerId !== session.user.id && !body.commentMarkOnly) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Snapshot version before content changes (skip for commentMarkOnly saves)
  if (body.content && doc.content && !body.commentMarkOnly && body.content !== doc.content) {
    await maybeCreateVersion(id, doc.content, session.user.id);
  }

  const now = new Date();
  await db
    .update(documents)
    .set({
      title: body.commentMarkOnly ? doc.title : (body.title ?? doc.title),
      content: body.content ?? doc.content,
      updatedAt: now,
    })
    .where(eq(documents.id, id));

  return NextResponse.json({ ok: true, updatedAt: now.toISOString() });
}

// DELETE /api/documents/[id] — delete document (owner only)
export async function DELETE(
  _req: Request,
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

  if (doc.ownerId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(documents).where(eq(documents.id, id));
  return NextResponse.json({ ok: true });
}

// Throttled version creation: at most one per 5 minutes, keep last 50
async function maybeCreateVersion(
  documentId: string,
  content: string,
  userId: string
) {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Check latest version timestamp
  const latest = await db
    .select({ createdAt: documentVersions.createdAt })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.createdAt))
    .limit(1);

  if (latest.length > 0 && latest[0].createdAt > fiveMinutesAgo) {
    return; // Too recent, skip
  }

  // Insert new version
  await db.insert(documentVersions).values({
    id: nanoid(12),
    documentId,
    content,
    createdBy: userId,
    createdAt: new Date(),
  });

  // Prune old versions beyond 50
  const count = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));

  if (count[0].count > 50) {
    // Get the 50th newest version's createdAt
    const cutoff = await db
      .select({ createdAt: documentVersions.createdAt })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.createdAt))
      .limit(1)
      .offset(49);

    if (cutoff.length > 0) {
      await db
        .delete(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            sql`${documentVersions.createdAt} < ${Math.floor(cutoff[0].createdAt.getTime() / 1000)}`
          )
        );
    }
  }
}
