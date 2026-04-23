import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, comments, documentVersions } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { compareDocs, extractCommentMarkIds } from "@/lib/commentMarks";
import {
  logEvent,
  logTrace,
  warnTrace,
  seatbeltEnabled,
  contentHash,
} from "@/lib/saveTrace";

// Per-tab version snapshot. At most one row per 5 minutes per (doc, tab) so
// rapid typing doesn't flood the table. Prunes to last 50 per (doc, tab) so
// long-running docs don't grow unbounded.
async function maybeCreateTabVersion(
  documentId: string,
  tabId: string,
  content: string,
  userId: string
): Promise<"created" | "throttled" | "skipped"> {
  if (!content) return "skipped";
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const latest = await db
    .select({ createdAt: documentVersions.createdAt })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.tabId, tabId)
      )
    )
    .orderBy(desc(documentVersions.createdAt))
    .limit(1);

  if (latest.length > 0 && latest[0].createdAt > fiveMinutesAgo) {
    logEvent("tab.version.throttled", { documentId, tabId, userId });
    return "throttled";
  }

  await db.insert(documentVersions).values({
    id: nanoid(12),
    documentId,
    tabId,
    content,
    createdBy: userId,
    createdAt: new Date(),
  });

  logEvent("tab.version.created", {
    documentId,
    tabId,
    userId,
    contentHash: contentHash(content),
    contentLen: content.length,
  });

  // Prune beyond 50 per (doc, tab)
  const count = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.tabId, tabId)
      )
    );
  if ((count[0]?.count ?? 0) > 50) {
    const cutoff = await db
      .select({ createdAt: documentVersions.createdAt })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.tabId, tabId)
        )
      )
      .orderBy(desc(documentVersions.createdAt))
      .limit(1)
      .offset(49);
    if (cutoff.length > 0) {
      await db
        .delete(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.tabId, tabId),
            sql`${documentVersions.createdAt} < ${Math.floor(
              cutoff[0].createdAt.getTime() / 1000
            )}`
          )
        );
    }
  }

  return "created";
}

function readTraceHeaders(req: Request) {
  return {
    tabId: req.headers.get("x-tab-id") || null,
    docTabId: req.headers.get("x-doc-tab-id") || null,
    reqId: req.headers.get("x-req-id") || null,
    clientTs: req.headers.get("x-client-ts") || null,
  };
}

// GET /api/documents/[id]/tabs/[tabId]/content — fetch tab content + updatedAt
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; tabId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, tabId } = await params;
  const trace = readTraceHeaders(req);

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    columns: { ownerId: true },
  });
  if (!doc) {
    logTrace("tab.get.404.doc", { docId: id, docTabIdPath: tabId, ...trace });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tab = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, tabId), eq(tabs.documentId, id)),
  });
  if (!tab) {
    logTrace("tab.get.404.tab", { docId: id, docTabIdPath: tabId, ...trace });
    return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  }

  logEvent("tab.get.ok", {
    docId: id,
    docTabIdPath: tabId,
    type: tab.type,
    updatedAt: tab.updatedAt,
    contentHash: contentHash(tab.content),
    contentLen: tab.content?.length ?? 0,
    ...trace,
  });

  return NextResponse.json({
    ...tab,
    isOwner: doc.ownerId === session.user.id,
  });
}

// PUT /api/documents/[id]/tabs/[tabId]/content — save tab content
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; tabId: string }> }
) {
  const session = await auth();
  const trace = readTraceHeaders(req);

  if (!session?.user) {
    logTrace("tab.put.401", { ...trace });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, tabId } = await params;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    logTrace("tab.put.404.doc", { docId: id, docTabIdPath: tabId, ...trace });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tab = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, tabId), eq(tabs.documentId, id)),
  });
  if (!tab) {
    logTrace("tab.put.404.tab", { docId: id, docTabIdPath: tabId, ...trace });
    return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  }

  const body = await req.json();
  const isOwner = doc.ownerId === session.user.id;
  const commentMarkOnly = Boolean(body.commentMarkOnly);

  if (!isOwner && !commentMarkOnly) {
    logTrace("tab.put.403", {
      docId: id,
      docTabIdPath: tabId,
      userId: session.user.id,
      ownerId: doc.ownerId,
      commentMarkOnly,
      ...trace,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Same commentMark diff diagnostics as documents PUT — preserves the ongoing
  // save-revert investigation (PR #14). tabId is now part of the save-trace.
  let diff: ReturnType<typeof compareDocs> | null = null;
  let parseError: string | null = null;
  if (body.content && tab.content) {
    try {
      const before = JSON.parse(tab.content);
      const incoming = JSON.parse(body.content);
      diff = compareDocs(before, incoming);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  // Orphan check: comments are scoped to tab, so only scan this tab's comment rows.
  let orphanMarks: string[] = [];
  let orphanComments: string[] = [];
  if (body.content) {
    try {
      const incoming = JSON.parse(body.content);
      const marksInContent = extractCommentMarkIds(incoming);
      const commentRows = await db
        .select({ markId: comments.commentMarkId })
        .from(comments)
        .where(and(eq(comments.documentId, id), eq(comments.tabId, tabId)));
      const marksInDb = new Set(commentRows.map((r) => r.markId));
      orphanMarks = [...marksInContent].filter((m) => !marksInDb.has(m));
      orphanComments = [...marksInDb].filter((m) => !marksInContent.has(m));
    } catch {
      /* ignore */
    }
  }

  const entryLog = {
    docId: id,
    docTabIdPath: tabId,
    tabType: tab.type,
    userId: session.user.id,
    isOwner,
    commentMarkOnly,
    contentLenBefore: tab.content?.length ?? 0,
    contentLenIncoming: body.content?.length ?? 0,
    hashBefore: contentHash(tab.content),
    hashIncoming: contentHash(body.content),
    updatedAtBefore: tab.updatedAt,
    marksBefore: diff?.marksBefore ?? null,
    marksIncoming: diff?.marksIncoming ?? null,
    marksAdded: diff?.marksAdded ?? null,
    marksRemoved: diff?.marksRemoved ?? null,
    nonMarkContentDiffers: diff?.nonMarkContentDiffers ?? null,
    orphanMarks: orphanMarks.length > 0 ? orphanMarks : null,
    orphanComments: orphanComments.length > 0 ? orphanComments : null,
    parseError,
    ...trace,
  };

  // Always-on: we never want to be blind to a save landing on the server.
  logEvent("tab.put.entry", entryLog);

  if (
    seatbeltEnabled() &&
    commentMarkOnly &&
    diff &&
    diff.nonMarkContentDiffers
  ) {
    warnTrace("tab.put.seatbelt.reject", {
      ...entryLog,
      reason: "commentMarkOnly PUT with non-mark content diff",
    });
    return NextResponse.json(
      {
        error: "Content diff exceeds commentMarkOnly scope",
        marksAdded: diff.marksAdded,
        marksRemoved: diff.marksRemoved,
      },
      { status: 409 }
    );
  }

  if (commentMarkOnly && diff && diff.nonMarkContentDiffers) {
    warnTrace("tab.put.suspicious.overwrite", entryLog);
  }

  if (
    body.content &&
    tab.content &&
    body.content.length < tab.content.length * 0.8
  ) {
    warnTrace("tab.put.content.shrink", {
      ...entryLog,
      shrinkPct: Math.round(
        (1 - body.content.length / tab.content.length) * 100
      ),
    });
  }

  const now = new Date();
  await db
    .update(tabs)
    .set({
      content: body.content ?? tab.content,
      updatedAt: now,
    })
    .where(and(eq(tabs.id, tabId), eq(tabs.documentId, id)));

  // Bump documents.updatedAt so the doc list still shows recent activity.
  await db
    .update(documents)
    .set({ updatedAt: now })
    .where(eq(documents.id, id));

  // Snapshot the saved content as a version row — at most one per 5 minutes
  // per (doc, tab). Owner-only, skip comment-mark-only saves (nothing to
  // snapshot). Non-fatal: a version failure must never break the save itself.
  if (isOwner && !commentMarkOnly && body.content) {
    try {
      await maybeCreateTabVersion(id, tabId, body.content, session.user.id);
    } catch (err) {
      warnTrace("tab.version.failed", {
        docId: id,
        docTabIdPath: tabId,
        userId: session.user.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logEvent("tab.put.ok", {
    docId: id,
    docTabIdPath: tabId,
    userId: session.user.id,
    isOwner,
    commentMarkOnly,
    updatedAt: now.toISOString(),
    contentLenAfter: (body.content ?? tab.content)?.length ?? 0,
    hashAfter: contentHash(body.content ?? tab.content),
    ...trace,
  });

  return NextResponse.json({ ok: true, updatedAt: now.toISOString() });
}
