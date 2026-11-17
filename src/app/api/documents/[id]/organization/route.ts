import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, folders } from "@/lib/db/schema";
import { parseOrganizationChanges } from "@/lib/document-organization";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc || doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const parsed = parseOrganizationChanges(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const changes = parsed.changes;

  if (changes.folderId) {
    const folder = await db.query.folders.findFirst({
      where: and(eq(folders.id, changes.folderId), eq(folders.ownerId, session.user.id)),
    });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  await db.update(documents).set(changes).where(eq(documents.id, id));
  return NextResponse.json({ ok: true, ...changes });
}
