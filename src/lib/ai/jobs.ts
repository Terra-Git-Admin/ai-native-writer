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
import { getAction, resolveSystemPrompt } from "@/lib/ai/actions";
import { logEvent } from "@/lib/saveTrace";

export type PromptKind =
  | "plot_chunks"
  | "next_episode_plot"
  | "next_reference_episode"
  | "format_tab"
  | "series_skeleton"
  | "series_skeleton_predefined"
  | "series_skeleton_auto";

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

// Pin the active-jobs map to globalThis so it survives Next.js / Turbopack
// HMR module reloads in dev. Without this, every edit to this file would
// reset the map, and a request handled by a freshly-reloaded module would
// see an empty map even when another module instance has live runners.
// In production this is a no-op (modules don't reload).
//
// Same pattern Drizzle/Prisma recommend for their client singletons in the
// Next.js App Router.
const _g = globalThis as unknown as {
  __aiNativeWriter_activeJobs?: Map<string, JobRunner>;
};
const activeJobs: Map<string, JobRunner> = (_g.__aiNativeWriter_activeJobs ??=
  new Map());

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
  userGuidance?: string;
}

// Insert the row, register the runner in the in-memory map SYNCHRONOUSLY,
// then kick off the LLM call asynchronously. The caller's SSE subscriber
// races us, so the runner MUST be in the map before this function
// returns — otherwise the subscriber sees `getActiveRunner === undefined`
// + `status === 'pending'` and emits subscribe_after_runner_evicted.
//
// Order matters:
//   1. DB block-check (refuse if a job is already running in this doc)
//   2. DB insert (persist the pending row)
//   3. Build runner + set in activeJobs (synchronous — closes the race)
//   4. Fire-and-forget the LLM call
export async function createJob(opts: CreateJobOpts): Promise<{ id: string }> {
  // Per-document block: refuse if ANY pending|running job exists in this
  // document, regardless of which tab originated it. The user model is
  // "one AI generation at a time per doc" — the chat thread is doc-scoped
  // so multiple concurrent jobs would fight for the same chat surface.
  const existing = await db.query.aiJobs.findFirst({
    where: and(
      eq(aiJobs.documentId, opts.documentId),
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
    userGuidance: opts.userGuidance ?? null,
    createdBy: opts.userId,
    createdAt: now,
  });

  // Synchronous runner registration. Closes the race window: any SSE
  // subscriber that arrives now will find this runner, attach listeners,
  // and replay the buffer (initially empty) before tokens start flowing.
  const controller = new AbortController();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  // Default 'error' listener so emitting 'error' never throws
  // ERR_UNHANDLED_ERROR. Without this, a job that fails BEFORE any SSE
  // subscriber attaches (e.g., the LLM call fails fast on auth/decryption)
  // crashes the whole process. The DB row still records the failure; the
  // SSE endpoint reads it from there on subscriber attach.
  emitter.on("error", () => {});
  const runner: JobRunner = {
    id,
    controller,
    emitter,
    status: "pending",
    buffer: "",
  };
  activeJobs.set(id, runner);

  logEvent("ai_job.create", {
    id,
    documentId: opts.documentId,
    tabId: opts.tabId,
    promptKind: opts.promptKind,
    modelId: opts.modelId,
    thinking: opts.thinking,
    activeJobsSize: activeJobs.size,
  });

  // Kick off the LLM call. Errors inside runJob are handled there — never
  // throw out to the caller.
  void runJob(id, runner);

  return { id };
}

export function getActiveRunner(id: string): JobRunner | undefined {
  return activeJobs.get(id);
}

// Cancel a job. Best-effort across two layers:
//   1. Live runner present? Abort the streaming LLM call. Its catch arm
//      writes status='cancelled' to the DB.
//   2. No live runner but DB still says pending|running? Mark cancelled
//      directly. Heals stranded rows that would otherwise block future
//      jobs in this document via the per-doc concurrency check.
//
// Returns true if any cancellation effect was applied (controller aborted
// OR DB row updated). Idempotent — calling on an already-terminal row
// returns false without side effects.
export async function cancelJob(id: string): Promise<boolean> {
  const runner = activeJobs.get(id);
  if (
    runner &&
    (runner.status === "running" || runner.status === "pending")
  ) {
    runner.controller.abort();
    return true;
  }

  // No live runner OR the runner is already terminal-but-still-in-map
  // for the TTL window. If the DB says still pending|running, heal it.
  const updated = await db
    .update(aiJobs)
    .set({
      status: "cancelled",
      failureReason: "cancelled_without_runner",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(aiJobs.id, id),
        inArray(aiJobs.status, ["pending", "running"])
      )
    )
    .returning({ id: aiJobs.id });
  return updated.length > 0;
}

// Run a job to completion. Streams tokens to the in-memory EventEmitter
// for live SSE subscribers, accumulates the full result in runner.buffer,
// and writes terminal state to the DB once.
//
// The runner is built and registered in activeJobs by createJob (sync),
// so by the time runJob is invoked the map already has it. We just look
// up the row, transition to running, and start the LLM call.
async function runJob(id: string, runner: JobRunner): Promise<void> {
  const job = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, id) });
  if (!job) {
    logEvent("ai_job.run.missing_row", { id });
    activeJobs.delete(id);
    return;
  }

  runner.status = "running";

  const startedAt = new Date();
  await db
    .update(aiJobs)
    .set({ status: "running", startedAt })
    .where(eq(aiJobs.id, id));

  runner.emitter.emit("status", "running");
  logEvent("ai_job.run.start", { id, promptKind: job.promptKind });

  try {
    const action = getAction(job.promptKind as PromptKind);
    const systemPrompt = await resolveSystemPrompt(action);
    const userMessage = await action.loadContext({
      documentId: job.documentId,
      tabId: job.tabId,
      userGuidance: job.userGuidance ?? undefined,
    });

    runner.emitter.emit("started", { startedAt: startedAt.toISOString() });

    const model = await getAIModel(job.modelId, job.thinking);

    const streamOptions: Parameters<typeof streamText>[0] = {
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      abortSignal: runner.controller.signal,
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
      runner.emitter.emit("token", chunk);
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

    runner.emitter.emit("done", {
      content: runner.buffer,
      completedAt: completedAt.toISOString(),
    });
    logEvent("ai_job.run.completed", {
      id,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      contentLength: runner.buffer.length,
    });
  } catch (err) {
    if (runner.controller.signal.aborted) {
      runner.status = "cancelled";
      const completedAt = new Date();
      await db
        .update(aiJobs)
        .set({ status: "cancelled", completedAt })
        .where(eq(aiJobs.id, id));
      runner.emitter.emit("cancelled", {
        completedAt: completedAt.toISOString(),
      });
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
      runner.emitter.emit("error", {
        reason,
        completedAt: completedAt.toISOString(),
      });
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

