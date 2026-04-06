import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, documentVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

// POST /api/documents/[id]/versions/revert — revert to a version (owner only)
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

  const { versionId } = await req.json();
  if (!versionId) {
    return NextResponse.json(
      { error: "versionId required" },
      { status: 400 }
    );
  }

  const version = await db.query.documentVersions.findFirst({
    where: eq(documentVersions.id, versionId),
  });

  if (!version || version.documentId !== id) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  // Snapshot current content before reverting
  if (doc.content) {
    await db.insert(documentVersions).values({
      id: nanoid(12),
      documentId: id,
      content: doc.content,
      createdBy: session.user.id,
      createdAt: new Date(),
    });
  }

  // Revert document to the version's content
  await db
    .update(documents)
    .set({
      content: version.content,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id));

  return NextResponse.json({ ok: true, content: version.content });
}
