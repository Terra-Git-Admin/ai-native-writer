import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, documentVersions, users } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

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

  // Optional per-tab filter. Writers work inside one tab at a time, so the
  // version history panel fetches its current tab's history — not the whole
  // doc's cross-tab history.
  const url = new URL(_req.url);
  const tabIdFilter = url.searchParams.get("tabId");

  const rows = await db
    .select({
      id: documentVersions.id,
      tabId: documentVersions.tabId,
      createdBy: users.name,
      createdAt: documentVersions.createdAt,
      contentLen: sql<number>`length(${documentVersions.content})`.as(
        "content_len"
      ),
    })
    .from(documentVersions)
    .leftJoin(users, eq(documentVersions.createdBy, users.id))
    .where(eq(documentVersions.documentId, id))
    .orderBy(desc(documentVersions.createdAt));

  const filtered = tabIdFilter
    ? rows.filter((r) => r.tabId === tabIdFilter)
    : rows;

  return NextResponse.json(filtered);
}
