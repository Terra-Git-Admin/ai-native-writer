import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, folders, tabs, users } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { buildCanonicalTabRows, CURRENT_CANONICAL_TABS_VERSION } from "@/lib/canonical-tabs";
import { isDocumentOrientation } from "@/lib/document-orientation";

// GET /api/documents — list all documents with owner info + recent comment count
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "all" &&
    session.user.role === "admin";

  const allDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      orientation: documents.orientation,
      ownerId: documents.ownerId,
      ownerName: users.name,
      ownerImage: users.image,
      folderId: documents.folderId,
      folderName: folders.name,
      archivedAt: documents.archivedAt,
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
    .leftJoin(folders, eq(documents.folderId, folders.id))
    .where(
      includeArchived
        ? undefined
        : or(
            eq(documents.ownerId, session.user.id),
            and(
              sql`${documents.ownerId} != ${session.user.id}`,
              sql`${documents.archivedAt} IS NULL`
            )
          )
    )
    .orderBy(desc(documents.updatedAt));

  return NextResponse.json(
    allDocs.map((doc) => ({
      ...doc,
      folderId: doc.ownerId === session.user.id ? doc.folderId : null,
      folderName: doc.ownerId === session.user.id ? doc.folderName : null,
    }))
  );
}

// POST /api/documents — create new document
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.orientation !== undefined && !isDocumentOrientation(body.orientation)) {
    return NextResponse.json(
      { error: "orientation must be portrait or landscape" },
      { status: 400 }
    );
  }
  const orientation = body.orientation ?? "portrait";
  const id = nanoid(12);
  const now = new Date();

  // Every new doc is seeded with the five canonical protected tabs (Original
  // Research, Characters, Microdrama Plots, Predefined Episodes, Workbook).
  // See canonical-tabs.ts for the fixed spec. Legacy docs get the same set
  // healed in by GET /api/documents/[id]/tabs.
  const { rows, firstTabId } = buildCanonicalTabRows(id, now);

  await db.insert(documents).values({
    id,
    title: body.title || "Untitled",
    orientation,
    content: null,
    ownerId: session.user.id,
    activeTabId: firstTabId,
    createdAt: now,
    updatedAt: now,
    canonicalTabsVersion: CURRENT_CANONICAL_TABS_VERSION,
  });

  await db.insert(tabs).values(rows);

  return NextResponse.json({ id, orientation });
}
