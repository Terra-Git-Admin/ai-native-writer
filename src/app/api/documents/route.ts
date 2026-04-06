import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, users, comments } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { desc, eq, and, gt, sql } from "drizzle-orm";

// GET /api/documents — list all documents with owner info + recent comment count
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const allDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      ownerId: documents.ownerId,
      ownerName: users.name,
      ownerImage: users.image,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      recentCommentCount: sql<number>`(
        SELECT COUNT(*) FROM comments c
        WHERE c.document_id = ${documents.id}
          AND c.created_at > ${Math.floor(twentyFourHoursAgo.getTime() / 1000)}
      )`.as("recent_comment_count"),
    })
    .from(documents)
    .leftJoin(users, eq(documents.ownerId, users.id))
    .orderBy(desc(documents.updatedAt));

  return NextResponse.json(allDocs);
}

// POST /api/documents — create new document
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const id = nanoid(12);
  const now = new Date();

  await db.insert(documents).values({
    id,
    title: body.title || "Untitled",
    content: null,
    ownerId: session.user.id,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id });
}
