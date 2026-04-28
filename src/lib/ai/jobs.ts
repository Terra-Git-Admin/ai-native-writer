// Durable AI generation jobs.
//
// One createJob() call → one ai_jobs row → fire-and-forget runJob() → token
// stream into in-memory EventEmitter → SSE subscribers receive live tokens →
// completion writes result_json once, frees the in-memory entry after a
// grace window so reconnecting subscribers can still replay.
//
// Why the in-memory layer exists: SSE subscribers may attach AFTER the
// runner started but BEFORE it finished. They need a buffer to catch up
// and a live emitter to receive subsequent tokens. After the runner
// completes the result lives in DB; late reconnects read from DB instead.
//
// Cancellation:
//   POST /api/ai/jobs/:id/cancel calls cancelJob(id), which fires the
//   AbortController. The streamText loop throws, runJob's catch arm
//   detects controller.signal.aborted and writes status='cancelled'.
//
// Boot recovery:
//   src/instrumentation.ts → register() calls recoverOrphanJobs() once
//   per Node process boot to mark any pre-existing pending|running rows
//   as failed='instance_restart'. Without this, frontend SSE subscribers
//   would hang waiting for events from a dead generator.

import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import { streamText } from "ai";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, getDb } from "@/lib/db";
import { aiJobs } from "@/lib/db/schema";
import { getAIModel } from "@/lib/ai/providers";
import { logEvent } from "@/lib/saveTrace";

export type PromptKind =
  | "plot_chunks"
  | "next_episode_plot"
  | "next_reference_episode";

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobRunner {
  id: string;
  controller: AbortController;
  emitter: EventEmitter;
  status: JobStatus;
  // Accumulated assistant text so far. Late subscribers replay this on attach
  // before listening for new tokens.
  buffer: string;
}

const activeJobs = new Map<string, JobRunner>();

// How long an entry lingers in activeJobs after terminal status. Lets a
// browser that reconnected just after completion replay from memory rather
// than hitting the DB. 5 minutes covers reload-during-network-blip.
const ACTIVE_JOB_TTL_MS = 5 * 60 * 1000;

export class JobBlockedError extends Error {
  constructor(public existingJobId: string) {
    super(
      `A job is already running in this tab (id=${existingJobId}). Cancel it before starting another.`
    );
    this.name = "JobBlockedError";
  }
}

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job ${id} not found.`);
    this.name = "JobNotFoundError";
  }
}

export interface CreateJobOpts {
  documentId: string;
  tabId: string;
  promptKind: PromptKind;
  modelId: string;
  thinking: boolean;
  userId: string;
}

// Insert the row, then kick off the runner. The runner is fire-and-forget
// from the caller's perspective — the POST handler returns the job id and
// the SSE endpoint subscribes separately.
export async function createJob(opts: CreateJobOpts): Promise<{ id: string }> {
  // Per-tab block: refuse if any pending|running job exists in this
  // (documentId, tabId). Frontend surfaces this as the "Block & toast" UX.
  const existing = await db.query.aiJobs.findFirst({
    where: and(
      eq(aiJobs.documentId, opts.documentId),
      eq(aiJobs.tabId, opts.tabId),
      inArray(aiJobs.status, ["pending", "running"])
    ),
  });
  if (existing) {
    throw new JobBlockedError(existing.id);
  }

  const id = nanoid(12);
  const now = new Date();

  await db.insert(aiJobs).values({
    id,
    documentId: opts.documentId,
    tabId: opts.tabId,
    promptKind: opts.promptKind,
    status: "pending",
    modelId: opts.modelId,
    thinking: opts.thinking,
    createdBy: opts.userId,
    createdAt: now,
  });

  logEvent("ai_job.create", {
    id,
    documentId: opts.documentId,
    tabId: opts.tabId,
    promptKind: opts.promptKind,
    modelId: opts.modelId,
    thinking: opts.thinking,
  });

  // Kick off the runner. Errors inside runJob are handled there — never
  // throw out to the caller.
  void runJob(id);

  return { id };
}

export function getActiveRunner(id: string): JobRunner | undefined {
  return activeJobs.get(id);
}

export function cancelJob(id: string): boolean {
  const runner = activeJobs.get(id);
  if (!runner) return false;
  if (runner.status !== "running" && runner.status !== "pending") return false;
  runner.controller.abort();
  return true;
}

// Run a job to completion. Streams tokens to the in-memory EventEmitter
// for live SSE subscribers, accumulates the full result in runner.buffer,
// and writes terminal state to the DB once.
async function runJob(id: string): Promise<void> {
  const job = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, id) });
  if (!job) {
    logEvent("ai_job.run.missing_row", { id });
    return;
  }

  const controller = new AbortController();
  const emitter = new EventEmitter();
  // EventEmitter default max listeners is 10. Multiple browser tabs/windows
  // could subscribe to the same job; raise the bound so we don't trip the
  // dev-time leak warning.
  emitter.setMaxListeners(50);

  const runner: JobRunner = {
    id,
    controller,
    emitter,
    status: "running",
    buffer: "",
  };
  activeJobs.set(id, runner);

  const startedAt = new Date();
  await db
    .update(aiJobs)
    .set({ status: "running", startedAt })
    .where(eq(aiJobs.id, id));

  emitter.emit("status", "running");
  logEvent("ai_job.run.start", { id, promptKind: job.promptKind });

  try {
    const systemPrompt = await getSystemPrompt(job.promptKind as PromptKind);
    const userMessage = await loadContext(
      job.promptKind as PromptKind,
      job.documentId,
      job.tabId
    );

    runner.emitter.emit("started", { startedAt: startedAt.toISOString() });

    const model = await getAIModel(job.modelId, job.thinking);

    const streamOptions: Parameters<typeof streamText>[0] = {
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      abortSignal: controller.signal,
    };
    if (job.thinking) {
      streamOptions.providerOptions = {
        anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
        google: { thinkingConfig: { thinkingBudget: 10000 } },
      };
    }

    const result = streamText(streamOptions);

    for await (const chunk of result.textStream) {
      runner.buffer += chunk;
      emitter.emit("token", chunk);
    }

    // Stream completed without error.
    runner.status = "completed";
    const completedAt = new Date();
    await db
      .update(aiJobs)
      .set({
        status: "completed",
        resultJson: JSON.stringify({ content: runner.buffer }),
        contextSnapshot: JSON.stringify({ userMessage }),
        completedAt,
      })
      .where(eq(aiJobs.id, id));

    emitter.emit("done", {
      content: runner.buffer,
      completedAt: completedAt.toISOString(),
    });
    logEvent("ai_job.run.completed", {
      id,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      contentLength: runner.buffer.length,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      runner.status = "cancelled";
      const completedAt = new Date();
      await db
        .update(aiJobs)
        .set({ status: "cancelled", completedAt })
        .where(eq(aiJobs.id, id));
      emitter.emit("cancelled", { completedAt: completedAt.toISOString() });
      logEvent("ai_job.run.cancelled", { id });
    } else {
      runner.status = "failed";
      const reason = err instanceof Error ? err.message : String(err);
      const completedAt = new Date();
      await db
        .update(aiJobs)
        .set({
          status: "failed",
          failureReason: reason,
          completedAt,
        })
        .where(eq(aiJobs.id, id));
      emitter.emit("error", { reason, completedAt: completedAt.toISOString() });
      logEvent("ai_job.run.failed", { id, reason });
    }
  } finally {
    // Keep the entry in the map briefly so a reconnecting subscriber can
    // replay rather than hitting the DB. After the TTL, fall through to
    // DB-replay path in the SSE endpoint.
    setTimeout(() => {
      activeJobs.delete(id);
    }, ACTIVE_JOB_TTL_MS).unref();
  }
}

// Heal orphan rows from a previous Node process. Called once per boot from
// instrumentation.ts. Without this, the frontend SSE endpoint would hang
// forever waiting for events from a generator that no longer exists.
export async function recoverOrphanJobs(): Promise<number> {
  // Use getDb() directly: the proxy export is fine for normal request flow,
  // but on boot we want to make sure the underlying instance is created
  // before we issue an UPDATE.
  getDb();
  const now = new Date();
  const orphans = await db
    .update(aiJobs)
    .set({
      status: "failed",
      failureReason: "instance_restart",
      completedAt: now,
    })
    .where(
      or(eq(aiJobs.status, "pending"), eq(aiJobs.status, "running"))
    )
    .returning({ id: aiJobs.id });

  if (orphans.length > 0) {
    logEvent("ai_job.boot.recovered_orphans", {
      count: orphans.length,
      ids: orphans.map((o) => o.id),
    });
  }
  return orphans.length;
}

// ─── Stubs for chunk D ───
//
// These produce real output so the machinery is end-to-end testable on a
// real model call. Chunk D replaces them with the action-specific context
// loaders + system prompts (Plot Chunks, Next Episode Plot, Next Reference
// Episode).

async function getSystemPrompt(kind: PromptKind): Promise<string> {
  // STUB: replaced in chunk D with full per-action system prompts pulled
  // from src/lib/ai/prompts.ts (or the prompts table for editability).
  return `You are an AI assistant for a vertical mobile microdrama scriptwriting tool. The user has triggered the action "${kind}". Acknowledge the action and produce a short placeholder response describing what you would generate. The full per-action prompts ship in chunk D.`;
}

async function loadContext(
  kind: PromptKind,
  documentId: string,
  tabId: string | null
): Promise<string> {
  // STUB: replaced in chunk D with action-specific context loaders that
  // read the relevant tabs and assemble the input.
  return `Action: ${kind}\nDocument: ${documentId}\nTab: ${tabId ?? "(none)"}\n\nThis is a placeholder context payload. Chunk D wires real context loading.`;
}
