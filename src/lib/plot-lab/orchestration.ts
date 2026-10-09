import type { PlotLabAction, PlotLabControllerState, PlotLabTurnPlan } from "@/lib/plot-lab/controller";

export type PlotLabSpecialistMode =
  | "plot_lab_source_soul_scan"
  | "plot_lab_character_analyst"
  | "plot_lab_paywall_architect"
  | "plot_lab_premise_bridge"
  | "plot_lab_universe_builder"
  | "plot_lab_runway_sketch";

export type PlotLabAuditorMode = "plot_lab_continuity_audit";

export interface PlotLabSpecialistOption {
  label: string;
  detail: string;
  response?: string;
}

export interface PlotLabSpecialistBrief {
  specialist?: string;
  status?: "ready" | "needs_input" | "blocked";
  objective?: string;
  lockedContextUsed?: string[];
  evidenceUsed?: string[];
  recommendedMove?: "ask" | "show_options" | "clarify" | "review_lock" | "build" | "summarize";
  visibleFrame?: string;
  question?: string;
  options?: PlotLabSpecialistOption[];
  lockCandidate?: {
    section?: string;
    block?: string;
    text?: string;
  };
  risks?: string[];
}

export interface PlotLabRuntimeInput {
  controllerState: PlotLabControllerState;
  writerMove: string;
  writerVisibleText?: string;
  controllerIntent?: string;
  answerSource?: string;
  selectedAction?: PlotLabAction;
  recentChat: string;
  controllerDirective: string;
  contextBlock: string;
  plotLabDecisions: string;
  previousAssistantText?: string;
  previousOptions?: PlotLabSpecialistOption[];
}

export interface PlotLabSpecialistRoute {
  mode: PlotLabSpecialistMode;
  objective: string;
  qualityGate: string;
  auditAfter: boolean;
}

const PHASE_OBJECTIVES: Record<string, string> = {
  opening_read: "Confirm the EP1 read from saved evidence before character work starts.",
  protagonist_discovery: "Find the next protagonist question from locked canon and EP1 evidence.",
  character_discovery: "Clarify the current consequential role without repeating already locked facts.",
  relationship_discovery: "Use role locks to open broader universe, pressure, power, and story-world possibilities without repeating character-motivation questions.",
  character_summary: "Summarize the current focus and prepare a lock review.",
  plot_transition_gate: "Review the character board before moving to monetization.",
  monetization_discovery: "Find or refine the paid image/question without jumping into runway tactics.",
  monetization_lock_review: "Review the monetization candidate for lock, revise, or reroll.",
  premise_bridge: "Ask what must evolve in the story world, pressure ecology, or character conditions between EP1 and the later monetization point.",
  stage_1_complete: "Summarize Stage 1 as complete through monetization lock; do not build beats or episode runway.",
  plot_thread: "Build runway only from locked endpoint, bridge, and character context.",
};

export function selectPlotLabSpecialist(state: PlotLabControllerState): PlotLabSpecialistRoute {
  if (state.phase === "opening_read") {
    return {
      mode: "plot_lab_source_soul_scan",
      objective: PHASE_OBJECTIVES.opening_read,
      qualityGate: "Use EP1 evidence and Plot Lab Decisions only; produce a concise opening read and fixed confirmation.",
      auditAfter: false,
    };
  }

  if (
    state.phase === "protagonist_discovery" ||
    state.phase === "character_discovery" ||
    state.phase === "relationship_discovery" ||
    state.phase === "character_summary" ||
    state.phase === "plot_transition_gate"
  ) {
    return {
      mode: state.phase === "relationship_discovery" ? "plot_lab_universe_builder" : "plot_lab_character_analyst",
      objective: PHASE_OBJECTIVES[state.phase] ?? "Advance the current character or relationship focus.",
      qualityGate: state.phase === "relationship_discovery"
        ? "Ask a broad, writer-led universe/pressure question that opens possibility; do not ask another disguised character-motivation question or any beat mechanics."
        : "Use locked facts first, ask one open question unless the controller requests a compact review, and do not repeat solved locks.",
      auditAfter: true,
    };
  }

  if (state.phase === "monetization_discovery" || state.phase === "monetization_lock_review") {
    return {
      mode: "plot_lab_paywall_architect",
      objective: PHASE_OBJECTIVES[state.phase] ?? "Find the monetization endpoint.",
      qualityGate: "Keep monetization visual, paid-answer driven, and later than EP1; no first-beat or Episode 2 mechanics.",
      auditAfter: true,
    };
  }

  if (state.phase === "premise_bridge") {
    return {
      mode: "plot_lab_universe_builder",
      objective: state.frameworkSlot === "lock_review"
        ? "Review the EP1-to-paywall bridge candidate for lock, revise, or reroll."
        : PHASE_OBJECTIVES.premise_bridge,
      qualityGate: state.frameworkSlot === "lock_review"
        ? "Restate the bridge candidate compactly; do not ask a new universe, pressure, outside-force, or transformation question."
        : "Bridge EP1 to monetization through open-ended universe, pressure, power, and transformation questions; no beats, scene tactics, or Episode 2.",
      auditAfter: true,
    };
  }

  if (state.phase === "stage_1_complete") {
    return {
      mode: "plot_lab_universe_builder",
      objective: PHASE_OBJECTIVES.stage_1_complete,
      qualityGate: "Stop at Stage 1 completion. Do not propose episode beats, runway, or E2.",
      auditAfter: false,
    };
  }

  return {
    mode: "plot_lab_runway_sketch",
    objective: PHASE_OBJECTIVES.plot_thread,
    qualityGate: "Build executable episode movement only after endpoint and bridge are ready.",
    auditAfter: true,
  };
}

export function renderPlotLabRuntimeInput(input: PlotLabRuntimeInput, route: PlotLabSpecialistRoute): string {
  return [
    "## Plot Lab Runtime Input",
    "Use this as the context pack for the current mini-agent. Plot Lab Decisions is the story canon; recent chat is only for local references and latest user intent.",
    `- Specialist mode: ${route.mode}`,
    `- Specialist objective: ${route.objective}`,
    `- Quality gate: ${route.qualityGate}`,
    `- Writer move: ${input.writerMove}`,
    input.writerVisibleText && input.writerVisibleText !== input.writerMove
      ? `- Writer visible answer: ${input.writerVisibleText}`
      : "",
    input.controllerIntent && input.controllerIntent !== input.writerMove
      ? `- Controller intent: ${input.controllerIntent}`
      : "",
    input.answerSource
      ? `- Answer source: ${input.answerSource}`
      : "",
    input.selectedAction
      ? `- Selected action: ${JSON.stringify(input.selectedAction)}`
      : "",
    `- Current phase: ${input.controllerState.phase}`,
    `- Current focus: ${input.controllerState.currentFocus}`,
    `- Question vector: ${input.controllerState.questionVector}`,
    `- Framework slot: ${input.controllerState.frameworkSlot}`,
    `- Question count: ${input.controllerState.questionsInFocus}/${input.controllerState.maxQuestionsPerFocus}`,
    `- Question mode: ${input.controllerState.turnPlan.questionMode}`,
    `- Allow model options: ${input.controllerState.turnPlan.allowModelOptions ? "yes" : "no"}`,
    `- Available UI actions: ${input.controllerState.turnPlan.actions.length ? input.controllerState.turnPlan.actions.map((action) => `${action.kind}: ${action.label}`).join(" | ") : "none"}`,
    `- Allowed next move: ${input.controllerState.allowedNextMove}`,
    `- Forbidden moves: ${input.controllerState.forbiddenMoves.join(" | ")}`,
    input.plotLabDecisions.trim()
      ? `## Relevant Locked Canon From Plot Lab Decisions\n${input.plotLabDecisions.trim()}`
      : "## Relevant Locked Canon From Plot Lab Decisions\nNone yet.",
    input.previousAssistantText?.trim()
      ? `## Previous Assistant Text For Reroll/Revision\n${input.previousAssistantText.trim()}`
      : "",
    input.previousOptions?.length
      ? `## Previous Options To Replace\n${JSON.stringify(input.previousOptions, null, 2)}`
      : "",
    input.contextBlock,
    input.recentChat,
    input.controllerDirective,
    `## Writer Move\n${input.writerMove}`,
  ].filter(Boolean).join("\n\n");
}

export function renderSpecialistOutputContract(): string {
  return [
    "## Specialist Output Contract",
    "Return one JSON object only. No markdown, no tags, no prose outside JSON. JSON is a transport envelope; creative fields should remain natural language and concise.",
    "Schema:",
    JSON.stringify({
      specialist: "short specialist name",
      status: "ready | needs_input | blocked",
      objective: "one sentence",
      lockedContextUsed: ["relevant locked fact used"],
      evidenceUsed: ["EP1/source fact used"],
      recommendedMove: "ask | show_options | clarify | review_lock | build | summarize",
      visibleFrame: "one short sentence Levi may show before the question",
      question: "one writer-facing question, if needed",
      options: [
        { label: "2-7 word story label", detail: "what choosing this means", response: "optional prompt value" },
        { label: "2-7 word story label", detail: "what choosing this means", response: "optional prompt value" }
      ],
      lockCandidate: { section: "Plot Lab Decisions section", block: "block title", text: "save-ready canon if applicable" },
      risks: ["short risk if any"]
    }, null, 2),
    "Rules:",
    "- If Allow model options is yes: set recommendedMove to show_options, ask one open question, and include exactly 2 concise answer-starter options by default. Use 3 only when the third is a genuinely different story state.",
    "- If Allow model options is yes: do not put option labels inside the question text. The app renders options as action buttons.",
    "- If Allow model options is yes: options are scaffolds for the writer to react to, not final canon locks. Keep labels concrete and details short.",
    "- If Allow model options is no: default to one open question, set recommendedMove to ask, and leave options empty. Do not return answer starters.",
    "- If Question mode is fixed_actions or Framework slot is lock_review: do not ask a new discovery question. Return a compact review/summary frame and leave options empty.",
    "- Use the Framework slot as the active question job. Do not substitute a neighboring framework slot because it seems more interesting.",
    "- Fixed UI actions such as lock, revise, add context, reroll, and custom answer are supplied by the app; do not duplicate them in options.",
    "- If Last user intent is quality_feedback: do not treat the writer text as story canon. Ask one simpler, fresher question.",
    "- If Last user intent is low_signal: do not infer a lock. Ask one easier question that requires less precision.",
  ].join("\n");
}

export function parseSpecialistBrief(rawText: string): { brief: PlotLabSpecialistBrief | null; error: string | null } {
  const trimmed = rawText.trim();
  if (!trimmed) return { brief: null, error: "empty specialist response" };

  const jsonText = extractJsonObject(trimmed);
  if (!jsonText) return { brief: null, error: "no JSON object found" };

  try {
    const parsed = JSON.parse(jsonText) as PlotLabSpecialistBrief;
    return { brief: normalizeSpecialistBrief(parsed), error: null };
  } catch (error) {
    return { brief: null, error: error instanceof Error ? error.message : "JSON parse failed" };
  }
}

export function specialistBriefToLeviContext(
  brief: PlotLabSpecialistBrief | null,
  route: PlotLabSpecialistRoute,
  parseError: string | null,
  auditBrief?: string
): string {
  return [
    "## Structured Specialist Brief",
    parseError ? `Parse error: ${parseError}` : "",
    brief ? JSON.stringify(brief, null, 2) : "No valid specialist JSON. Use the controller directive and ask one safe open question.",
    auditBrief ? `## Continuity Audit Brief\n${auditBrief}` : "",
    "## Orchestrator Instruction",
    `You are rendering the ${route.mode} result for the writer. Do not expose JSON or specialist names. Use visibleFrame + question when present. If the continuity audit provides a corrected "Question needed", use that corrected question instead of the original. Do not invent options if options is empty. Never write inline A/B/C options or comma-separated menus; the app renders structured options separately.`,
  ].filter(Boolean).join("\n\n");
}

export function specialistOptionsToActions(
  brief: PlotLabSpecialistBrief | null,
  turnPlan: PlotLabTurnPlan
): PlotLabAction[] {
  if (!turnPlan.allowModelOptions) return [];
  return (brief?.options ?? [])
    .filter((option) => option.label?.trim())
    .slice(0, 4)
    .map((option, index) => ({
      actionId: `requested_option_${index + 1}`,
      kind: "requested_option" as const,
      label: option.label.trim(),
      detail: option.detail?.trim() ?? "",
      response: option.response?.trim() || (option.detail?.trim() ? `${option.label.trim()}: ${option.detail.trim()}` : option.label.trim()),
    }));
}

function normalizeSpecialistBrief(brief: PlotLabSpecialistBrief): PlotLabSpecialistBrief {
  return {
    ...brief,
    lockedContextUsed: Array.isArray(brief.lockedContextUsed) ? brief.lockedContextUsed.filter(Boolean).slice(0, 8) : [],
    evidenceUsed: Array.isArray(brief.evidenceUsed) ? brief.evidenceUsed.filter(Boolean).slice(0, 8) : [],
    options: Array.isArray(brief.options)
      ? brief.options
          .filter((option) => option && option.label)
          .slice(0, 4)
          .map((option) => ({
            label: option.label.trim(),
            detail: option.detail?.trim() ?? "",
            response: option.response?.trim(),
          }))
      : [],
    risks: Array.isArray(brief.risks) ? brief.risks.filter(Boolean).slice(0, 5) : [],
  };
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}
