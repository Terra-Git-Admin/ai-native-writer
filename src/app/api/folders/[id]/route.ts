import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, folders } from "@/lib/db/schema";
import { validateFolderName } from "@/lib/document-organization";

async function ownedFolder(id: string, ownerId: string) {
  return db.query.folders.findFirst({
    where: and(eq(folders.id, id), eq(folders.ownerId, ownerId)),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownedFolder(id, session.user.id))) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const validation = validateFolderName(body.name);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const { name, normalizedName } = validation;
  const duplicate = await db.query.folders.findFirst({
    where: and(
      eq(folders.ownerId, session.user.id),
      eq(folders.normalizedName, normalizedName)
    ),
  });
  if (duplicate && duplicate.id !== id) {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }

  await db.update(folders).set({ name, normalizedName, updatedAt: new Date() }).where(eq(folders.id, id));
  return NextResponse.json({ ok: true, name });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownedFolder(id, session.user.id))) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const moved = db.transaction((tx) => {
    const result = tx
      .update(documents)
      .set({ folderId: null })
      .where(and(eq(documents.folderId, id), eq(documents.ownerId, session.user.id)))
      .run();
    tx.delete(folders).where(eq(folders.id, id)).run();
    return result.changes;
  });
  return NextResponse.json({ ok: true, moved });
}
