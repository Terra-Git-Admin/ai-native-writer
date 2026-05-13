import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, documentVersions, comments } from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
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
    reqId: req.headers.get("x-req-id") || null,
    clientTs: req.headers.get("x-client-ts") || null,
  };
}

// GET /api/documents/[id]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const trace = readTraceHeaders(req);
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });

  if (!doc) {
    logTrace("doc.get.404", { docId: id, userId: session.user.id, ...trace });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  logTrace("doc.get.ok", {
    docId: id,
    userId: session.user.id,
    isOwner: doc.ownerId === session.user.id,
    updatedAt: doc.updatedAt,
    contentHash: contentHash(doc.content),
    contentLen: doc.content?.length ?? 0,
    ...trace,
  });

  return NextResponse.json({
    ...doc,
    isOwner: doc.ownerId === session.user.id,
  });
}

// PUT /api/documents/[id] — update document
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const trace = readTraceHeaders(req);

  if (!session?.user) {
    logTrace("doc.put.401", { ...trace });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });

  if (!doc) {
    logTrace("doc.put.404", { docId: id, userId: session.user.id, ...trace });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const isOwner = doc.ownerId === session.user.id;
  const commentMarkOnly = Boolean(body.commentMarkOnly);

  if (!isOwner && !commentMarkOnly) {
    logTrace("doc.put.403", {
      docId: id,
      userId: session.user.id,
      ownerId: doc.ownerId,
      commentMarkOnly,
      ...trace,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Compute commentMark diff + non-mark content diff for every content-carrying PUT.
  // This is the primary diagnostic signal — tells us exactly what the client is
  // trying to change and whether a reviewer/stale tab is overwriting the doc.
  let diff: ReturnType<typeof compareDocs> | null = null;
  let parseError: string | null = null;
  if (body.content && doc.content) {
    try {
      const before = JSON.parse(doc.content);
      const incoming = JSON.parse(body.content);
      diff = compareDocs(before, incoming);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  // Orphan check: commentMarks in incoming content vs comment rows in DB.
  let orphanMarks: string[] = [];
  let orphanComments: string[] = [];
  let orphanCommentDetails: { markId: string; tabId: string | null }[] = [];
  if (body.content) {
    try {
      const incoming = JSON.parse(body.content);
      const marksInContent = extractCommentMarkIds(incoming);
      const commentRows = await db
        .select({ markId: comments.commentMarkId, tabId: comments.tabId })
        .from(comments)
        .where(eq(comments.documentId, id));
      const marksInDb = new Set(commentRows.map((r) => r.markId));
      orphanMarks = [...marksInContent].filter((m) => !marksInDb.has(m));
      orphanComments = [...marksInDb].filter((m) => !marksInContent.has(m));
      orphanCommentDetails = commentRows.filter((r) => !marksInContent.has(r.markId));
    } catch {
      /* ignore */
    }
  }

  const entryLog = {
    docId: id,
    userId: session.user.id,
    isOwner,
    commentMarkOnly,
    contentLenBefore: doc.content?.length ?? 0,
    contentLenIncoming: body.content?.length ?? 0,
    hashBefore: contentHash(doc.content),
    hashIncoming: contentHash(body.content),
    updatedAtBefore: doc.updatedAt,
    marksBefore: diff?.marksBefore ?? null,
    marksIncoming: diff?.marksIncoming ?? null,
    marksAdded: diff?.marksAdded ?? null,
    marksRemoved: diff?.marksRemoved ?? null,
    nonMarkContentDiffers: diff?.nonMarkContentDiffers ?? null,
    orphanMarks: orphanMarks.length > 0 ? orphanMarks : null,
    orphanComments: orphanComments.length > 0 ? orphanComments : null,
    orphanCommentDetails: orphanCommentDetails.length > 0 ? orphanCommentDetails : null,
    parseError,
    ...trace,
  };

  logTrace("doc.put.entry", entryLog);

  // SEATBELT — reject commentMarkOnly PUTs that also change non-mark content.
  // Gated by DEBUG_SAVE_SEATBELT=true so it can be disabled independently of logs.
  if (
    seatbeltEnabled() &&
    commentMarkOnly &&
    diff &&
    diff.nonMarkContentDiffers
  ) {
    warnTrace("doc.put.seatbelt.reject", {
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

  // Always warn on the anti-pattern even when seatbelt is off — this is the
  // smoking gun for the reviewer-overwrite hypothesis.
  if (commentMarkOnly && diff && diff.nonMarkContentDiffers) {
    warnTrace("doc.put.suspicious.overwrite", entryLog);
  }

  // Warn on unexpected content shrinkage (>20% smaller). Cheap tripwire for any
  // rollback-style bug we haven't yet identified.
  if (
    body.content &&
    doc.content &&
    body.content.length < doc.content.length * 0.8
  ) {
    warnTrace("doc.put.content.shrink", {
      ...entryLog,
      shrinkPct: Math.round(
        (1 - body.content.length / doc.content.length) * 100
      ),
    });
  }

  // Snapshot version before content changes (skip for commentMarkOnly saves)
  let versionCreated: "created" | "throttled" | "skipped" = "skipped";
  if (
    body.content &&
    doc.content &&
    !commentMarkOnly &&
    body.content !== doc.content
  ) {
    versionCreated = await maybeCreateVersion(id, doc.content, session.user.id);
  }

  const now = new Date();
  await db
    .update(documents)
    .set({
      title: commentMarkOnly ? doc.title : (body.title ?? doc.title),
      content: body.content ?? doc.content,
      updatedAt: now,
    })
    .where(eq(documents.id, id));

  logTrace("doc.put.ok", {
    docId: id,
    userId: session.user.id,
    isOwner,
    commentMarkOnly,
    versionCreated,
    updatedAt: now.toISOString(),
    hashAfter: contentHash(body.content ?? doc.content),
    ...trace,
  });

  return NextResponse.json({ ok: true, updatedAt: now.toISOString() });
}

// DELETE /api/documents/[id] — delete document (owner only)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const trace = readTraceHeaders(req);
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (doc.ownerId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(documents).where(eq(documents.id, id));
  logTrace("doc.delete.ok", { docId: id, userId: session.user.id, ...trace });
  return NextResponse.json({ ok: true });
}

// Throttled version creation: at most one per 5 minutes, keep last 50.
// Returns "created" | "throttled" for logging.
async function maybeCreateVersion(
  documentId: string,
  content: string,
  userId: string
): Promise<"created" | "throttled"> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Check latest version timestamp
  const latest = await db
    .select({ createdAt: documentVersions.createdAt })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.createdAt))
    .limit(1);

  if (latest.length > 0 && latest[0].createdAt > fiveMinutesAgo) {
    logTrace("doc.version.throttled", { documentId, userId });
    return "throttled";
  }

  // Insert new version
  await db.insert(documentVersions).values({
    id: nanoid(12),
    documentId,
    content,
    createdBy: userId,
    createdAt: new Date(),
  });
  logTrace("doc.version.created", {
    documentId,
    userId,
    contentHash: contentHash(content),
    contentLen: content.length,
  });

  // Prune old versions beyond 50
  const count = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));

  if (count[0].count > 50) {
    // Get the 50th newest version's createdAt
    const cutoff = await db
      .select({ createdAt: documentVersions.createdAt })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.createdAt))
      .limit(1)
      .offset(49);

    if (cutoff.length > 0) {
      await db
        .delete(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            sql`${documentVersions.createdAt} < ${Math.floor(cutoff[0].createdAt.getTime() / 1000)}`
          )
        );
    }
  }
  return "created";
}
