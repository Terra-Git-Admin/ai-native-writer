import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { logTrace } from "@/lib/saveTrace";
import { getCharacterQuestionnaireStatus } from "@/lib/ai/actions";
import {
  EDIT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  FEEDBACK_SYSTEM_PROMPT,
  FORMAT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  WORLD_STATE_SYSTEM_PROMPT,
  BEAT_GEN_SYSTEM_PROMPT,
  CAUSALITY_SYSTEM_PROMPT,
  PLOT_SYNTH_SYSTEM_PROMPT,
  CONTINUATION_STATE_SYSTEM_PROMPT,
  CONTINUATION_BEAT_SYSTEM_PROMPT,
  CONTINUATION_LOGIC_SYSTEM_PROMPT,
  CONTINUATION_SYNTH_SYSTEM_PROMPT,
  PREDEFINED_LAB_BEATS_PROMPT,
  PREDEFINED_LAB_DRAFT_PROMPT,
  PREDEFINED_LAB_DIALOGUE_PASS_PROMPT,
  PREDEFINED_LAB_ITERATE_PROMPT,
} from "@/lib/ai/prompts";
import { getActivePredefinedLabDialogueGuide } from "@/lib/ai/predefined-lab-dialogue-guide";

type Mode =
  | "edit" | "draft" | "feedback" | "format" | "chat"
  | "pipe_world_state" | "pipe_beat_gen" | "pipe_causality" | "pipe_plot_synth"
  | "pipe_continuation_state" | "pipe_continuation_beats" | "pipe_continuation_logic" | "pipe_continuation_synth"
  | "predef_lab_beats" | "predef_lab_draft" | "predef_lab_iterate" | "predef_lab_dialogue_pass";

const FALLBACK_PROMPTS: Record<Mode, string> = {
  edit: EDIT_SYSTEM_PROMPT,
  draft: DRAFT_SYSTEM_PROMPT,
  feedback: FEEDBACK_SYSTEM_PROMPT,
  format: FORMAT_SYSTEM_PROMPT,
  chat: CHAT_SYSTEM_PROMPT,
  pipe_world_state: WORLD_STATE_SYSTEM_PROMPT,
  pipe_beat_gen:    BEAT_GEN_SYSTEM_PROMPT,
  pipe_causality:   CAUSALITY_SYSTEM_PROMPT,
  pipe_plot_synth:  PLOT_SYNTH_SYSTEM_PROMPT,
  pipe_continuation_state: CONTINUATION_STATE_SYSTEM_PROMPT,
  pipe_continuation_beats: CONTINUATION_BEAT_SYSTEM_PROMPT,
  pipe_continuation_logic: CONTINUATION_LOGIC_SYSTEM_PROMPT,
  pipe_continuation_synth: CONTINUATION_SYNTH_SYSTEM_PROMPT,
  predef_lab_beats: PREDEFINED_LAB_BEATS_PROMPT,
  predef_lab_draft: PREDEFINED_LAB_DRAFT_PROMPT,
  predef_lab_iterate: PREDEFINED_LAB_ITERATE_PROMPT,
  predef_lab_dialogue_pass: PREDEFINED_LAB_DIALOGUE_PASS_PROMPT,
};
const VALID_MODES: ReadonlySet<string> = new Set<Mode>([
  "edit",
  "draft",
  "feedback",
  "format",
  "chat",
  "pipe_world_state",
  "pipe_beat_gen",
  "pipe_causality",
  "pipe_plot_synth",
  "pipe_continuation_state",
  "pipe_continuation_beats",
  "pipe_continuation_logic",
  "pipe_continuation_synth",
  "predef_lab_beats",
  "predef_lab_draft",
  "predef_lab_iterate",
  "predef_lab_dialogue_pass",
]);

const ADMIN_ONLY_MODES: ReadonlySet<Mode> = new Set<Mode>([
  "pipe_continuation_state",
  "pipe_continuation_beats",
  "pipe_continuation_logic",
  "pipe_continuation_synth",
]);
const PERSONA_DEPENDENT_MODES: ReadonlySet<Mode> = new Set<Mode>([
  "chat",
  "draft",
  "edit",
  "feedback",
]);

async function getSystemPrompt(mode: Mode): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, mode),
  });
  const source = row?.content ? "db" : "fallback";
  logTrace("ai.edit.prompt_resolved", { mode, source });
  return row?.content || FALLBACK_PROMPTS[mode];
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const body = await req.json();
  const {
    messages,
    mode = "edit",
    modelId,
    thinking,
    documentId,
  } = body as {
    messages: { role: "user" | "assistant"; content: string }[];
    mode?: string;
    modelId?: string;
    thinking?: boolean;
    documentId?: string;
  };

  if (!messages || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      { status: 400 }
    );
  }

  const resolvedMode = typeof mode === "string" ? mode : "edit";
  if (!VALID_MODES.has(resolvedMode)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
  const safeMode = resolvedMode as Mode;
  const isAdmin = (session.user as { role?: string } | undefined)?.role === "admin";
  if (ADMIN_ONLY_MODES.has(safeMode) && !isAdmin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  if (PERSONA_DEPENDENT_MODES.has(safeMode) && !documentId) {
    return new Response(JSON.stringify({ error: "documentId is required" }), { status: 400 });
  }
  if (PERSONA_DEPENDENT_MODES.has(safeMode) && documentId) {
    const characterState = await getCharacterQuestionnaireStatus(documentId);
    if (characterState.needsPreparation || characterState.incompleteCharacters.length > 0) {
      return new Response(JSON.stringify({
        error: "Complete the Character Questionnaire for every major character before triggering other AI agents.",
        code: "CHARACTER_QUESTIONNAIRE_INCOMPLETE",
      }), { status: 409 });
    }
  }

  const baseSystemPrompt = await getSystemPrompt(safeMode);
  const dialogueGuide =
    safeMode === "predef_lab_dialogue_pass"
      ? await getActivePredefinedLabDialogueGuide()
      : "";
  const systemPrompt =
    safeMode === "predef_lab_dialogue_pass"
      ? `${baseSystemPrompt}\n\n## Dialogue Quality Guide\n${dialogueGuide}`
      : baseSystemPrompt;

  try {
    const requestedModelId =
      safeMode === "predef_lab_dialogue_pass"
        ? "gemini-3.1-pro-preview"
        : modelId || "claude-sonnet-4-20250514";
    const model = await getAIModel(
      requestedModelId,
      true
    );
    logTrace("ai.edit.model_resolved", {
      mode: safeMode,
      requestedModelId: modelId || null,
      modelId: requestedModelId,
      forcedProvider: safeMode === "predef_lab_dialogue_pass" ? "google" : null,
    });

    const streamOptions: Parameters<typeof streamText>[0] = {
      model,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
        google: { thinkingConfig: { thinkingBudget: 10000 } },
      },
    };

    const result = streamText(streamOptions);
    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
