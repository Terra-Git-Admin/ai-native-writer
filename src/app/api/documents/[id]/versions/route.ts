import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, documentVersions, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

// GET /api/documents/[id]/versions — list versions (owner only)
export async function GET(
  _req: Request,
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

  const versions = await db
    .select({
      id: documentVersions.id,
      createdBy: users.name,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .leftJoin(users, eq(documentVersions.createdBy, users.id))
    .where(eq(documentVersions.documentId, id))
    .orderBy(desc(documentVersions.createdAt));

  return NextResponse.json(versions);
}
