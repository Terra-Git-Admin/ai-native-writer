import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comments, users } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";

// GET /api/comments?documentId=xxx
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const documentId = url.searchParams.get("documentId");
  if (!documentId) {
    return NextResponse.json(
      { error: "documentId required" },
      { status: 400 }
    );
  }

  const allComments = await db
    .select({
      id: comments.id,
      commentMarkId: comments.commentMarkId,
      content: comments.content,
      quotedText: comments.quotedText,
      authorId: comments.authorId,
      authorName: users.name,
      authorImage: users.image,
      parentId: comments.parentId,
      resolved: comments.resolved,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.documentId, documentId))
    .orderBy(comments.createdAt);

  return NextResponse.json(allComments);
}

// POST /api/comments
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { documentId, commentMarkId, content, quotedText, parentId } = body;

  if (!documentId || !commentMarkId || !content) {
    return NextResponse.json(
      { error: "documentId, commentMarkId, and content are required" },
      { status: 400 }
    );
  }

  const id = nanoid(12);
  await db.insert(comments).values({
    id,
    documentId,
    commentMarkId,
    content,
    quotedText: quotedText || null,
    authorId: session.user.id,
    parentId: parentId || null,
    resolved: false,
    createdAt: new Date(),
  });

  return NextResponse.json({ id });
}
