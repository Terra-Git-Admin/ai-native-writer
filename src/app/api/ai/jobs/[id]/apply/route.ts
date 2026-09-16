import { NextResponse } from "next/server";
import { and, desc, eq, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiJobs, documentVersions, documents, tabs } from "@/lib/db/schema";
import {
  applyModeForPromptKind,
  parseJobResultJson,
  validateJobOutput,
} from "@/lib/ai/job-output";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { taggedTextToTiptapDoc } from "@/lib/editor/tagged-parser";
import { contentHash, logEvent } from "@/lib/saveTrace";

async function snapshotVersion(
  documentId: string,
  tabId: string,
  content: string,
  userId: string
): Promise<"created" | "duplicate"> {
  const latest = await db
    .select({ content: documentVersions.content })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.tabId, tabId)
      )
    )
    .orderBy(desc(documentVersions.createdAt))
    .limit(1);

  if (latest[0]?.content === content) return "duplicate";

  await db.insert(documentVersions).values({
    id: nanoid(12),
    documentId,
    tabId,
    content,
    createdBy: userId,
    createdAt: new Date(),
  });
  return "created";
}

async function nextTabPosition(documentId: string): Promise<number> {
  const rows = await db
    .select({ max: max(tabs.position) })
    .from(tabs)
    .where(eq(tabs.documentId, documentId));
  return (rows[0]?.max ?? -1) + 1;
}

async function nextCustomPageNumber(documentId: string): Promise<number> {
  const rows = await db
    .select()
    .from(tabs)
    .where(and(eq(tabs.documentId, documentId), eq(tabs.type, "custom")));
  return rows.length + 1;
}

async function createWorkbookPage(
  documentId: string,
  label: string,
  content: string
) {
  const tabId = nanoid(12);
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const timestamp = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const fullContent = `[P] ${label} · ${timestamp}\n\n${content.trim()}`;
  const jsonString = JSON.stringify(taggedTextToTiptapDoc(fullContent));

  await db.insert(tabs).values({
    id: tabId,
    documentId,
    title: `Page ${await nextCustomPageNumber(documentId)}`,
    type: "custom",
    sequenceNumber: null,
    content: jsonString,
    position: await nextTabPosition(documentId),
    isProtected: false,
    createdAt: now,
    updatedAt: now,
  });

  return { tabId, content: jsonString };
}

async function findExistingAppliedTab(
  documentId: string,
  content: string
): Promise<{ tabId: string; content: string } | null> {
  const needle = content.trim();
  if (!needle) return null;
  const rows = await db
    .select({ id: tabs.id, content: tabs.content })
    .from(tabs)
    .where(eq(tabs.documentId, documentId));

  for (const row of rows) {
    const tagged = tiptapJsonToTagged(row.content ?? null);
    if (tagged.includes(needle)) {
      return { tabId: row.id, content: row.content ?? "" };
    }
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const t0 = Date.now();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    clientApplyId?: unknown;
  };
  const clientApplyId =
    typeof body.clientApplyId === "string" ? body.clientApplyId.trim() : "";
  if (!clientApplyId) {
    return NextResponse.json({ error: "Missing clientApplyId" }, { status: 400 });
  }

  const job = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, id) });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, job.documentId),
  });
  if (!doc || doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = parseJobResultJson(job.resultJson);
  if (result.apply) {
    if (result.apply.clientApplyId === clientApplyId) {
      return NextResponse.json({
        ok: true,
        landedTabId: result.apply.landedTabId,
        fellBack: result.apply.fellBack,
        idempotent: true,
      });
    }
    return NextResponse.json(
      { error: "Job output was already applied", reason: "already_applied" },
      { status: 409 }
    );
  }

  if (job.status !== "completed" || !result.content) {
    return NextResponse.json(
      { error: "Job is not completed", reason: "job_not_completed" },
      { status: 409 }
    );
  }

  const validation = validateJobOutput(job.promptKind, result.content);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.reason, reason: "invalid_output" },
      { status: 422 }
    );
  }

  logEvent("ai_job.apply.start", {
    id,
    documentId: job.documentId,
    originTabId: job.tabId,
    promptKind: job.promptKind,
    contentLength: result.content.length,
    clientApplyId,
  });

  let target = job.tabId
    ? await db.query.tabs.findFirst({
        where: and(eq(tabs.id, job.tabId), eq(tabs.documentId, job.documentId)),
      })
    : null;
  let fellBack = false;
  if (!target) {
    target =
      (await db.query.tabs.findFirst({
        where: and(eq(tabs.documentId, job.documentId), eq(tabs.type, "workbook")),
      })) ?? null;
    fellBack = true;
  }
  if (!target) {
    return NextResponse.json(
      { error: "Target tab missing", reason: "target_tab_missing" },
      { status: 409 }
    );
  }

  const mode = applyModeForPromptKind(job.promptKind);
  const label =
    job.promptKind === "next_reference_episode"
      ? "Create Pre-defined Episode"
      : job.promptKind;

  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  let landedTabId = target.id;
  let jsonString: string;
  const existingApplied = await findExistingAppliedTab(job.documentId, result.content);

  if (existingApplied) {
    landedTabId = existingApplied.tabId;
    jsonString = existingApplied.content;
  } else if (mode === "append" && target.type === "workbook") {
    const page = await createWorkbookPage(job.documentId, label, result.content);
    landedTabId = page.tabId;
    jsonString = page.content;
  } else {
    let outgoing = result.content;
    if (mode === "append") {
      const existingTagged = tiptapJsonToTagged(target.content ?? null);
      outgoing = existingTagged.trim()
        ? `${existingTagged.trim()}\n\n${result.content.trim()}`
        : result.content.trim();
    }
    jsonString = JSON.stringify(taggedTextToTiptapDoc(outgoing));

    await db
      .update(tabs)
      .set({ content: jsonString, updatedAt: now })
      .where(and(eq(tabs.id, target.id), eq(tabs.documentId, job.documentId)));
  }

  await db
    .update(documents)
    .set({ updatedAt: now })
    .where(eq(documents.id, job.documentId));

  const versionResult = await snapshotVersion(
    job.documentId,
    landedTabId,
    jsonString,
    session.user.id
  );
  const appliedAt = now.toISOString();
  const nextResult = {
    ...result,
    apply: { clientApplyId, landedTabId, fellBack, appliedAt },
  };
  await db
    .update(aiJobs)
    .set({ resultJson: JSON.stringify(nextResult) })
    .where(eq(aiJobs.id, id));

  logEvent("ai_job.apply.ok", {
    id,
    documentId: job.documentId,
    originTabId: job.tabId,
    landedTabId,
    fellBack,
    mode,
    contentLength: result.content.length,
    savedContentLength: jsonString.length,
    savedHash: contentHash(jsonString),
    versionResult,
    msTotal: Date.now() - t0,
  });

  return NextResponse.json({
    ok: true,
    landedTabId,
    fellBack,
    updatedAt: appliedAt,
  });
}
