import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, documentVersions, tabs } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logEvent, contentHash } from "@/lib/saveTrace";

// POST /api/documents/[id]/versions/revert — owner reverts to a saved version.
// Post-tabs: if the version has a tabId, we snapshot-then-restore that tab.
// Legacy (tabId=null): write to documents.content for compatibility.
export async function POST(
  req: Request,
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

  const { versionId } = await req.json();
  if (!versionId) {
    return NextResponse.json(
      { error: "versionId required" },
      { status: 400 }
    );
  }

  const version = await db.query.documentVersions.findFirst({
    where: eq(documentVersions.id, versionId),
  });

  if (!version || version.documentId !== id) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 }
    );
  }

  const now = new Date();

  if (version.tabId) {
    // Tab-scoped revert: snapshot current tab content first, then overwrite.
    const tab = await db.query.tabs.findFirst({
      where: and(eq(tabs.id, version.tabId), eq(tabs.documentId, id)),
    });
    if (!tab) {
      return NextResponse.json(
        { error: "Tab for this version no longer exists" },
        { status: 410 }
      );
    }
    if (tab.content) {
      await db.insert(documentVersions).values({
        id: nanoid(12),
        documentId: id,
        tabId: version.tabId,
        content: tab.content,
        createdBy: session.user.id,
        createdAt: now,
      });
    }
    await db
      .update(tabs)
      .set({ content: version.content, updatedAt: now })
      .where(eq(tabs.id, version.tabId));
    await db
      .update(documents)
      .set({ updatedAt: now })
      .where(eq(documents.id, id));

    logEvent("version.revert.tab", {
      docId: id,
      tabId: version.tabId,
      versionId,
      userId: session.user.id,
      contentLen: version.content.length,
      contentHashAfter: contentHash(version.content),
    });

    return NextResponse.json({
      ok: true,
      content: version.content,
      tabId: version.tabId,
    });
  }

  // Legacy path: pre-tabs version row. Snapshot current doc then write to
  // documents.content. New saves all flow through tabs so this path is only
  // hit when reverting historical rows.
  if (doc.content) {
    await db.insert(documentVersions).values({
      id: nanoid(12),
      documentId: id,
      tabId: null,
      content: doc.content,
      createdBy: session.user.id,
      createdAt: now,
    });
  }
  await db
    .update(documents)
    .set({ content: version.content, updatedAt: now })
    .where(eq(documents.id, id));

  logEvent("version.revert.doc", {
    docId: id,
    versionId,
    userId: session.user.id,
    contentLen: version.content.length,
  });

  return NextResponse.json({ ok: true, content: version.content });
}
