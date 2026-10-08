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
  PREDEFINED_LAB_DIALOGUE_DESIGN_PROMPT,
  PREDEFINED_LAB_DIALOGUE_PASS_PROMPT,
  PREDEFINED_LAB_ITERATE_PROMPT,
  PLOT_LAB_CHAT_SYSTEM_PROMPT,
  PLOT_LAB_CHARACTER_ANALYST_SYSTEM_PROMPT,
  PLOT_LAB_CONTINUITY_AUDIT_SYSTEM_PROMPT,
  PLOT_LAB_FINAL_PLOT_SYSTEM_PROMPT,
  PLOT_LAB_PAYWALL_ARCHITECT_SYSTEM_PROMPT,
  PLOT_LAB_PREMISE_BRIDGE_SYSTEM_PROMPT,
  PLOT_LAB_RUNWAY_SKETCH_SYSTEM_PROMPT,
  PLOT_LAB_SAVE_PREVIEW_SYSTEM_PROMPT,
  PLOT_LAB_SOURCE_SOUL_SCAN_SYSTEM_PROMPT,
  PLOT_LAB_UNIVERSE_BUILDER_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import {
  getActivePredefinedLabDialogueGuide,
  getActivePredefinedLabDialogueReferencePack,
} from "@/lib/ai/predefined-lab-dialogue-guide";
import {
  getPlotLabAccess,
  isPlotLabStage2Enabled,
  isPlotLabStage2Mode,
} from "@/lib/plot-lab/access";

type Mode =
  | "edit" | "draft" | "feedback" | "format" | "chat"
  | "pipe_world_state" | "pipe_beat_gen" | "pipe_causality" | "pipe_plot_synth"
  | "pipe_continuation_state" | "pipe_continuation_beats" | "pipe_continuation_logic" | "pipe_continuation_synth"
  | "predef_lab_beats" | "predef_lab_dialogue_design" | "predef_lab_draft" | "predef_lab_iterate" | "predef_lab_dialogue_pass"
  | "plot_lab_chat" | "plot_lab_source_soul_scan" | "plot_lab_character_analyst" | "plot_lab_continuity_audit"
  | "plot_lab_paywall_architect" | "plot_lab_premise_bridge" | "plot_lab_universe_builder" | "plot_lab_runway_sketch"
  | "plot_lab_save_preview" | "plot_lab_final_plot";

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
  predef_lab_dialogue_design: PREDEFINED_LAB_DIALOGUE_DESIGN_PROMPT,
  predef_lab_draft: PREDEFINED_LAB_DRAFT_PROMPT,
  predef_lab_iterate: PREDEFINED_LAB_ITERATE_PROMPT,
  predef_lab_dialogue_pass: PREDEFINED_LAB_DIALOGUE_PASS_PROMPT,
  plot_lab_chat: PLOT_LAB_CHAT_SYSTEM_PROMPT,
  plot_lab_source_soul_scan: PLOT_LAB_SOURCE_SOUL_SCAN_SYSTEM_PROMPT,
  plot_lab_character_analyst: PLOT_LAB_CHARACTER_ANALYST_SYSTEM_PROMPT,
  plot_lab_continuity_audit: PLOT_LAB_CONTINUITY_AUDIT_SYSTEM_PROMPT,
  plot_lab_paywall_architect: PLOT_LAB_PAYWALL_ARCHITECT_SYSTEM_PROMPT,
  plot_lab_premise_bridge: PLOT_LAB_PREMISE_BRIDGE_SYSTEM_PROMPT,
  plot_lab_universe_builder: PLOT_LAB_UNIVERSE_BUILDER_SYSTEM_PROMPT,
  plot_lab_runway_sketch: PLOT_LAB_RUNWAY_SKETCH_SYSTEM_PROMPT,
  plot_lab_save_preview: PLOT_LAB_SAVE_PREVIEW_SYSTEM_PROMPT,
  plot_lab_final_plot: PLOT_LAB_FINAL_PLOT_SYSTEM_PROMPT,
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
  "predef_lab_dialogue_design",
  "predef_lab_draft",
  "predef_lab_iterate",
  "predef_lab_dialogue_pass",
  "plot_lab_chat",
  "plot_lab_source_soul_scan",
  "plot_lab_character_analyst",
  "plot_lab_continuity_audit",
  "plot_lab_paywall_architect",
  "plot_lab_premise_bridge",
  "plot_lab_universe_builder",
  "plot_lab_runway_sketch",
  "plot_lab_save_preview",
  "plot_lab_final_plot",
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
const PREDEFINED_LAB_DIALOGUE_MODES: ReadonlySet<Mode> = new Set<Mode>([
  "predef_lab_dialogue_design",
  "predef_lab_dialogue_pass",
]);
const PLOT_LAB_MODES: ReadonlySet<Mode> = new Set<Mode>([
  "plot_lab_chat",
  "plot_lab_source_soul_scan",
  "plot_lab_character_analyst",
  "plot_lab_continuity_audit",
  "plot_lab_paywall_architect",
  "plot_lab_premise_bridge",
  "plot_lab_universe_builder",
  "plot_lab_runway_sketch",
  "plot_lab_save_preview",
  "plot_lab_final_plot",
]);

async function getSystemPrompt(mode: Mode): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, mode),
  });
  const useCodePrompt = PLOT_LAB_MODES.has(mode) && process.env.NODE_ENV !== "production";
  const dbDiffersFromCode = Boolean(row?.content && row.content !== FALLBACK_PROMPTS[mode]);
  const source = useCodePrompt ? "code_dev" : row?.content ? "db" : "fallback";
  logTrace("ai.edit.prompt_resolved", { mode, source });
  if (PLOT_LAB_MODES.has(mode) && dbDiffersFromCode) {
    logTrace("ai.edit.plot_lab_prompt_db_differs_from_code", {
      mode,
      source,
      dbLength: row?.content?.length ?? 0,
      codeLength: FALLBACK_PROMPTS[mode].length,
    });
  }
  return useCodePrompt ? FALLBACK_PROMPTS[mode] : row?.content || FALLBACK_PROMPTS[mode];
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
  if (PLOT_LAB_MODES.has(safeMode)) {
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId is required" }), { status: 400 });
    }
    if (isPlotLabStage2Mode(safeMode) && !isPlotLabStage2Enabled()) {
      return new Response(JSON.stringify({ error: "Plot Lab Stage 2 is not enabled" }), { status: 403 });
    }
    const plotLabAccess = await getPlotLabAccess(session, { documentId });
    if (!plotLabAccess.canUsePlotLab) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }
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
    PREDEFINED_LAB_DIALOGUE_MODES.has(safeMode)
      ? await getActivePredefinedLabDialogueGuide()
      : "";
  const dialogueReferencePack =
    safeMode === "predef_lab_dialogue_design"
      ? await getActivePredefinedLabDialogueReferencePack()
      : "";
  const systemPrompt =
    safeMode === "predef_lab_dialogue_design"
      ? baseSystemPrompt
      : safeMode === "predef_lab_dialogue_pass"
      ? `${baseSystemPrompt}\n\n## Dialogue Quality Guide\n${dialogueGuide}`
      : baseSystemPrompt;
  const preparedMessages =
    safeMode === "predef_lab_dialogue_design"
      ? messages.map((message, index) => {
          if (index !== 0 || message.role !== "user") return message;
          const supplementalContext = `## Dialogue Quality Guide\n${dialogueGuide}\n\n## Dialogue Reference Pack\n${dialogueReferencePack}`;
          return {
            ...message,
            content: message.content.includes("## Approved / Current Key Beats")
              ? message.content.replace(
                  "## Approved / Current Key Beats",
                  `${supplementalContext}\n\n## Approved / Current Key Beats`
                )
              : `${message.content}\n\n${supplementalContext}`,
          };
        })
      : messages;

  try {
    const requestedModelId =
      PREDEFINED_LAB_DIALOGUE_MODES.has(safeMode)
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
      forcedProvider: PREDEFINED_LAB_DIALOGUE_MODES.has(safeMode) ? "google" : null,
    });

    const streamOptions: Parameters<typeof streamText>[0] = {
      model,
      system: systemPrompt,
      messages: preparedMessages.map((m) => ({
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
