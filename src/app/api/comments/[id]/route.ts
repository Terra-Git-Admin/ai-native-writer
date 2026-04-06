import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PUT /api/comments/[id] — update/resolve
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
  });

  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.resolved !== undefined) updates.resolved = body.resolved;

  if (Object.keys(updates).length > 0) {
    await db.update(comments).set(updates).where(eq(comments.id, id));
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/comments/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
  });

  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only comment author or admin can delete
  if (
    comment.authorId !== session.user.id &&
    session.user.role !== "admin"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(comments).where(eq(comments.id, id));
  return NextResponse.json({ ok: true });
}
