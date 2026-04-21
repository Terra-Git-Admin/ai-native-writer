import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comments, documents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { logTrace } from "@/lib/saveTrace";
import { extractCommentMarkIds } from "@/lib/commentMarks";

function readTraceHeaders(req: Request) {
  return {
    tabId: req.headers.get("x-tab-id") || null,
    reqId: req.headers.get("x-req-id") || null,
  };
}

// PUT /api/comments/[id] — update/resolve
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const trace = readTraceHeaders(req);

  if (!session?.user) {
    logTrace("comment.update.401", { ...trace });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
  });

  if (!comment) {
    logTrace("comment.update.404", {
      commentId: id,
      userId: session.user.id,
      ...trace,
    });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.resolved !== undefined) updates.resolved = body.resolved;

  if (Object.keys(updates).length > 0) {
    await db.update(comments).set(updates).where(eq(comments.id, id));
  }

  logTrace("comment.update.ok", {
    commentId: id,
    documentId: comment.documentId,
    commentMarkId: comment.commentMarkId,
    authorId: comment.authorId,
    userId: session.user.id,
    changes: {
      content:
        body.content !== undefined
          ? {
              oldLen: comment.content.length,
              newLen: String(body.content ?? "").length,
            }
          : null,
      resolved:
        body.resolved !== undefined
          ? { old: comment.resolved, new: Boolean(body.resolved) }
          : null,
    },
    ...trace,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/comments/[id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const trace = readTraceHeaders(req);

  if (!session?.user) {
    logTrace("comment.delete.401", { ...trace });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
  });

  if (!comment) {
    logTrace("comment.delete.404", {
      commentId: id,
      userId: session.user.id,
      ...trace,
    });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only comment author or admin can delete
  if (
    comment.authorId !== session.user.id &&
    session.user.role !== "admin"
  ) {
    logTrace("comment.delete.403", {
      commentId: id,
      authorId: comment.authorId,
      userId: session.user.id,
      role: session.user.role,
      ...trace,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Orphan check: was the commentMark still present in doc.content at delete time?
  let markStillInDoc: boolean | null = null;
  try {
    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, comment.documentId),
      columns: { content: true },
    });
    if (doc?.content) {
      const marks = extractCommentMarkIds(JSON.parse(doc.content));
      markStillInDoc = marks.has(comment.commentMarkId);
    }
  } catch {
    /* ignore */
  }

  await db.delete(comments).where(eq(comments.id, id));

  // If this was a root comment, cascade-delete all replies (scoped to same document)
  let cascadeCount = 0;
  if (!comment.parentId) {
    const replies = await db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.commentMarkId, comment.commentMarkId),
          eq(comments.documentId, comment.documentId)
        )
      );
    cascadeCount = replies.length;
    await db
      .delete(comments)
      .where(
        and(
          eq(comments.commentMarkId, comment.commentMarkId),
          eq(comments.documentId, comment.documentId)
        )
      );
  }

  logTrace("comment.delete.ok", {
    commentId: id,
    documentId: comment.documentId,
    commentMarkId: comment.commentMarkId,
    authorId: comment.authorId,
    userId: session.user.id,
    wasRoot: !comment.parentId,
    cascadeDeletedReplies: cascadeCount,
    markStillInDoc,
    ...trace,
  });

  return NextResponse.json({ ok: true });
}
