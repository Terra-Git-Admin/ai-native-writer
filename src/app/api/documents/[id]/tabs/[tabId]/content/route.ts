import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, comments } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { compareDocs, extractCommentMarkIds } from "@/lib/commentMarks";
import {
  logTrace,
  warnTrace,
  seatbeltEnabled,
  contentHash,
} from "@/lib/saveTrace";

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

  logTrace("tab.get.ok", {
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

  logTrace("tab.put.entry", entryLog);

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

  logTrace("tab.put.ok", {
    docId: id,
    docTabIdPath: tabId,
    userId: session.user.id,
    isOwner,
    commentMarkOnly,
    updatedAt: now.toISOString(),
    hashAfter: contentHash(body.content ?? tab.content),
    ...trace,
  });

  return NextResponse.json({ ok: true, updatedAt: now.toISOString() });
}
