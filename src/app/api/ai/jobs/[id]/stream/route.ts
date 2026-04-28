import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiJobs, documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getActiveRunner } from "@/lib/ai/jobs";

// GET /api/ai/jobs/[id]/stream — Server-Sent Events stream of token, status,
// and terminal events for a job.
//
// Event types:
//   event: token         data: "<chunk>"
//   event: done          data: { content }
//   event: error         data: { reason }
//   event: cancelled     data: {}
//   event: status        data: "<status>"
//   :keepalive            (every 15s, no data)
//
// Behavior depending on job state at subscribe time:
//   - Active runner exists  → replay buffer, then attach live listeners.
//   - No runner, status terminal → reconstruct from DB and close immediately.
//   - No runner, status running/pending → race window. Treat as terminal:
//       send `error: { reason: "subscribe_after_runner_evicted" }` + close.
//       (This should be rare; runner stays in memory ACTIVE_JOB_TTL_MS past
//       completion, which dwarfs typical reconnect latency.)

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = await params;

  const job = await db.query.aiJobs.findFirst({
    where: eq(aiJobs.id, id),
  });
  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Ownership check via the document.
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, job.documentId),
  });
  if (!doc || doc.ownerId !== session.user.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          // ALWAYS JSON-stringify. SSE uses '\n' as a record separator;
          // a raw string with newlines would break the wire format and
          // the client would see only the first line of every event.
          // Encoding via JSON.stringify escapes newlines as \n inside a
          // single-line JSON string, which the client JSON-parses back.
          const payload = JSON.stringify(data);
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${payload}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const runner = getActiveRunner(id);

      if (!runner) {
        // No live runner. Reconstruct from DB.
        if (job.status === "completed") {
          const result = job.resultJson
            ? (JSON.parse(job.resultJson) as { content?: string })
            : {};
          if (result.content) {
            sendEvent("token", result.content);
          }
          sendEvent("done", {
            content: result.content ?? "",
            completedAt: job.completedAt,
          });
        } else if (job.status === "failed") {
          sendEvent("error", { reason: job.failureReason ?? "unknown" });
        } else if (job.status === "cancelled") {
          sendEvent("cancelled", { completedAt: job.completedAt });
        } else {
          // Runner gone but DB still says pending|running. Could only happen
          // if the runner crashed without updating DB (rare; instrumentation
          // boot recovery should heal these). Treat as a transient error.
          sendEvent("error", { reason: "subscribe_after_runner_evicted" });
        }
        closeOnce();
        return;
      }

      // Live subscriber. Replay any tokens the runner has already emitted,
      // then attach listeners for the rest.
      if (runner.buffer.length > 0) {
        sendEvent("token", runner.buffer);
      }

      const onToken = (chunk: string) => {
        sendEvent("token", chunk);
      };
      const onDone = (payload: { content: string; completedAt: string }) => {
        sendEvent("done", payload);
        cleanup();
        closeOnce();
      };
      const onError = (payload: { reason: string; completedAt: string }) => {
        sendEvent("error", payload);
        cleanup();
        closeOnce();
      };
      const onCancelled = (payload: { completedAt: string }) => {
        sendEvent("cancelled", payload);
        cleanup();
        closeOnce();
      };

      runner.emitter.on("token", onToken);
      runner.emitter.on("done", onDone);
      runner.emitter.on("error", onError);
      runner.emitter.on("cancelled", onCancelled);

      // Heartbeat keeps intermediaries from dropping the SSE connection.
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`:keepalive\n\n`));
        } catch {
          clearInterval(heartbeat);
          closed = true;
        }
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        runner.emitter.off("token", onToken);
        runner.emitter.off("done", onDone);
        runner.emitter.off("error", onError);
        runner.emitter.off("cancelled", onCancelled);
      };

      // Client disconnect: cleanup, but DO NOT cancel the job — server-side
      // job continues and the next subscriber can pick up.
      req.signal.addEventListener("abort", () => {
        cleanup();
        closeOnce();
      });
    },
    cancel() {
      // ReadableStream cancellation. Same as client disconnect.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable Nginx-style buffering on intermediaries.
      "X-Accel-Buffering": "no",
    },
  });
}
