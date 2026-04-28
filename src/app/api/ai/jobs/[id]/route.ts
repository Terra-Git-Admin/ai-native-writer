import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiJobs, documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/ai/jobs/[id] — fetch the current state of a job. Used by the UI
// to render badge state, completed-result fallback, and post-reload status.
export async function GET(
  _req: Request,
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

  return new Response(
    JSON.stringify({
      id: job.id,
      documentId: job.documentId,
      tabId: job.tabId,
      promptKind: job.promptKind,
      status: job.status,
      modelId: job.modelId,
      thinking: job.thinking,
      resultJson: job.resultJson,
      failureReason: job.failureReason,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
