import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiChatHistory, documents } from "@/lib/db/schema";
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

// DELETE /api/ai/chat-history — delete a single entry by id, OR clear all
// entries for a document. Caller passes one of:
//   ?id=<entryId>           → delete that one row (used by Discard)
//   ?documentId=<docId>     → delete every row for that doc (used by Clear)
// Both require the caller to own the parent document.
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const documentId = url.searchParams.get("documentId");

  if (id) {
    const entry = await db.query.aiChatHistory.findFirst({
      where: eq(aiChatHistory.id, id),
    });
    if (!entry) {
      return NextResponse.json({ ok: true });
    }
    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, entry.documentId),
    });
    if (!doc || doc.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await db.delete(aiChatHistory).where(eq(aiChatHistory.id, id));
    return NextResponse.json({ ok: true });
  }

  if (documentId) {
    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, documentId),
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.ownerId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await db.delete(aiChatHistory).where(eq(aiChatHistory.documentId, documentId));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "id or documentId required" },
    { status: 400 }
  );
}
