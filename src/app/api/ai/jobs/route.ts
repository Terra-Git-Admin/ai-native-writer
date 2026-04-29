import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createJob, JobBlockedError, type PromptKind } from "@/lib/ai/jobs";

const VALID_KINDS: ReadonlySet<PromptKind> = new Set<PromptKind>([
  "plot_chunks",
  "next_episode_plot",
  "next_reference_episode",
  "format_tab",
  "series_skeleton",
]);

interface CreateJobBody {
  documentId?: string;
  tabId?: string;
  promptKind?: string;
  modelId?: string;
  thinking?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: CreateJobBody;
  try {
    body = (await req.json()) as CreateJobBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { documentId, tabId, promptKind, modelId, thinking } = body;

  if (!documentId || typeof documentId !== "string") {
    return new Response(JSON.stringify({ error: "documentId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!tabId || typeof tabId !== "string") {
    return new Response(JSON.stringify({ error: "tabId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!promptKind || !VALID_KINDS.has(promptKind as PromptKind)) {
    return new Response(
      JSON.stringify({
        error: `Invalid promptKind. Must be one of: ${[...VALID_KINDS].join(", ")}`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!modelId || typeof modelId !== "string") {
    return new Response(JSON.stringify({ error: "modelId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the document exists and is owned by this user.
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) {
    return new Response(JSON.stringify({ error: "Document not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (doc.ownerId !== session.user.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify the tab belongs to this document.
  const tab = await db.query.tabs.findFirst({ where: eq(tabs.id, tabId) });
  if (!tab || tab.documentId !== documentId) {
    return new Response(
      JSON.stringify({ error: "Tab not found in this document" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { id } = await createJob({
      documentId,
      tabId,
      promptKind: promptKind as PromptKind,
      modelId,
      thinking: Boolean(thinking),
      userId: session.user.id,
    });
    return new Response(JSON.stringify({ id }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof JobBlockedError) {
      return new Response(
        JSON.stringify({
          error: err.message,
          code: "JOB_BLOCKED",
          existingJobId: err.existingJobId,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }
    const msg = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
