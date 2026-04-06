import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiChatHistory } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

// GET /api/ai/chat-history?documentId=xxx — load history for a document
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

  const entries = await db
    .select()
    .from(aiChatHistory)
    .where(eq(aiChatHistory.documentId, documentId))
    .orderBy(aiChatHistory.createdAt);

  return NextResponse.json(entries);
}

// POST /api/ai/chat-history — append an entry
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { documentId, entryType, role, content, mode } = await req.json();

  if (!documentId || !entryType || !mode) {
    return NextResponse.json(
      { error: "documentId, entryType, and mode are required" },
      { status: 400 }
    );
  }

  const id = nanoid(12);
  await db.insert(aiChatHistory).values({
    id,
    documentId,
    entryType,
    role: role || null,
    content: content || null,
    mode,
    createdAt: new Date(),
  });

  return NextResponse.json({ id });
}
