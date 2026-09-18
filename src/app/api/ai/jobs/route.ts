import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createJob, JobBlockedError, type PromptKind } from "@/lib/ai/jobs";
import { getCharacterQuestionnaireStatus } from "@/lib/ai/actions";

const VALID_KINDS: ReadonlySet<PromptKind> = new Set<PromptKind>([
  "plot_chunks",
  "next_episode_plot",
  "next_reference_episode",
  "pilot_episode",
  "format_tab",
  "series_skeleton",
  "series_skeleton_predefined",
  "series_skeleton_auto",
  "prepare_character_questionnaire",
]);

const PERSONA_DEPENDENT_KINDS: ReadonlySet<PromptKind> = new Set<PromptKind>([
  "next_reference_episode",
]);

interface CreateJobBody {
  documentId?: string;
  tabId?: string;
  promptKind?: string;
  modelId?: string;
  thinking?: boolean;
  userGuidance?: string;
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

  const { documentId, tabId, promptKind, modelId, thinking, userGuidance } = body;

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

  const effectiveKind = promptKind as PromptKind;
  let effectiveTabId = tabId;
  if (PERSONA_DEPENDENT_KINDS.has(effectiveKind)) {
    const characterState = await getCharacterQuestionnaireStatus(documentId);
    if (characterState.needsPreparation || characterState.incompleteCharacters.length > 0) {
      const names = characterState.incompleteCharacters.join(", ");
      return new Response(JSON.stringify({
        error: names ? "Complete the Character Questionnaire for " + names + " before triggering other AI agents." : "Add named characters and complete their profiles before triggering other AI agents.",
        code: "CHARACTER_QUESTIONNAIRE_INCOMPLETE",
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
  }

  if (effectiveKind === "prepare_character_questionnaire") {
    const characterState = await getCharacterQuestionnaireStatus(documentId);
    if (!characterState.needsPreparation) {
      return new Response(JSON.stringify({
        error: "Character names are already present. Use the Character Questionnaire in the AI Assistant to complete profiles.",
        code: "USE_CHARACTER_QUESTIONNAIRE",
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    const rows = await db.query.tabs.findMany({ where: eq(tabs.documentId, documentId) });
    const characters = rows.find((row) => row.type === "characters");
    if (!characters) {
      return new Response(JSON.stringify({ error: "Characters tab is missing from this document." }), {
        status: 409, headers: { "Content-Type": "application/json" },
      });
    }
    effectiveTabId = characters.id;
  }

  try {
    const { id } = await createJob({
      documentId,
      tabId: effectiveTabId,
      promptKind: effectiveKind,
      modelId,
      thinking: Boolean(thinking),
      userId: session.user.id,
      userGuidance: typeof userGuidance === "string" ? userGuidance : undefined,
    });
    return new Response(JSON.stringify({ id, kind: effectiveKind, tabId: effectiveTabId }), {
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
