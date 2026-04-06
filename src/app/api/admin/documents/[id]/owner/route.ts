import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PUT /api/admin/documents/[id]/owner — transfer ownership
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { newOwnerId } = await req.json();

  if (!newOwnerId) {
    return NextResponse.json(
      { error: "newOwnerId required" },
      { status: 400 }
    );
  }

  // Verify document exists
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Verify new owner exists
  const newOwner = await db.query.users.findFirst({
    where: eq(users.id, newOwnerId),
  });
  if (!newOwner) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await db
    .update(documents)
    .set({ ownerId: newOwnerId, updatedAt: new Date() })
    .where(eq(documents.id, id));

  return NextResponse.json({ ok: true });
}
