import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiJobs, documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cancelJob } from "@/lib/ai/jobs";

// POST /api/ai/jobs/[id]/cancel — abort an in-flight job. Idempotent:
// already-terminal jobs return 200 with cancelled=false.
export async function POST(
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

  const job = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, id) });
  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, job.documentId),
  });
  if (!doc || doc.ownerId !== session.user.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cancelled = await cancelJob(id);
  return new Response(JSON.stringify({ cancelled }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
