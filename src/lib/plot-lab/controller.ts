export interface PlotLabChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type PlotLabConversationPhase =
  | "opening_read"
  | "awaiting_context"
  | "role_board_check"
  | "protagonist_discovery"
  | "character_discovery"
  | "relationship_discovery"
  | "character_summary"
  | "plot_transition_gate"
  | "monetization_discovery"
  | "monetization_lock_review"
  | "premise_bridge"
  | "stage_1_complete"
  | "plot_thread";

export type PlotLabFocusType =
  | "opening"
  | "protagonist"
  | "character"
  | "relationship"
  | "plot";

export type PlotLabFocusId =
  | "opening"
  | "protagonist"
  | "primary_counterpart"
  | "operator_pressure"
  | "relationship_core"
  | "plot";

export type PlotLabAssistantTurnKind =
  | "opening_read"
  | "discovery_question"
  | "checkpoint_summary"
  | "transition_next_focus"
  | "character_board_summary"
  | "monetization_bridge"
  | "monetization_review"
  | "premise_bridge"
  | "stage_1_complete"
  | "plot_gate";

export type PlotLabUserIntent =
  | "confirm_opening"
  | "add_context"
  | "move_next"
  | "different_angle"
  | "move_into_plot"
  | "lock_current"
  | "continue_here"
  | "revise_current"
  | "reroll_options"
  | "skip_role"
  | "skip_monetization"
  | "stay_character"
  | "skip_or_too_narrow"
  | "quality_feedback"
  | "low_signal"
  | "normal";

export type PlotLabQuestionMode = "typed" | "fixed_actions" | "requested_options";

export type PlotLabActionKind =
  | "confirm_opening"
  | "add_context"
  | "lock_current"
  | "continue_here"
  | "revise_current"
  | "move_into_plot"
  | "stay_character"
  | "requested_option"
  | "reroll_options"
  | "custom_answer";

export type PlotLabQuestionVector =
  | "evidence_read"
  | "character_anchor"
  | "spark_in_world"
  | "external_pressure"
  | "relationship_function"
  | "choice_space"
  | "power_language"
  | "world_rule"
  | "world_pressure"
  | "unresolved_ecology"
  | "monetization_endpoint"
  | "monetization_delta"
  | "lock_review";

export type PlotLabFrameworkSlot =
  | "opening_read"
  | "screen_promise"
  | "world_effect"
  | "relationship_conversion"
  | "new_door_new_cost"
  | "pressure_style"
  | "power_rule"
  | "arena"
  | "engine_secret"
  | "paid_image"
  | "earned_change"
  | "lock_review"
  | "stage_1_complete";

export type PlotLabRoleSlot =
  | "protagonist"
  | "primary_counterpart"
  | "operator_pressure"
  | "world_force";

export type PlotLabSlotStatus =
  | "identified"
  | "unclear"
  | "skipped"
  | "not_present"
  | "locked";

export type PlotLabRoleSlotStatuses = Record<PlotLabRoleSlot, PlotLabSlotStatus>;

export interface PlotLabAction {
  actionId: string;
  kind: PlotLabActionKind;
  label: string;
  detail: string;
  response: string;
}

export interface PlotLabTurnPlan {
  turnKind: PlotLabAssistantTurnKind;
  phase: PlotLabConversationPhase;
  focus: PlotLabFocusId;
  questionVector: PlotLabQuestionVector;
  frameworkSlot: PlotLabFrameworkSlot;
  questionMode: PlotLabQuestionMode;
  actions: PlotLabAction[];
  allowModelOptions: boolean;
}

export interface PlotLabControllerState {
  phase: PlotLabConversationPhase;
  focusType: PlotLabFocusType;
  focusId: PlotLabFocusId;
  focusIndex: number;
  currentFocus: string;
  questionsInFocus: number;
  maxQuestionsPerFocus: number;
  completedFocuses: PlotLabFocusId[];
  checkpointPending: boolean;
  assistantTurnKind: PlotLabAssistantTurnKind;
  lastUserIntent: PlotLabUserIntent;
  skipCount: number;
  roleSlots: PlotLabRoleSlotStatuses;
  pendingRoleClarification: PlotLabRoleSlot | null;
  monetizationStatus: PlotLabSlotStatus;
  questionVector: PlotLabQuestionVector;
  frameworkSlot: PlotLabFrameworkSlot;
  waitingFor: string;
  plotDetailAllowed: boolean;
  questionMode: PlotLabQuestionMode;
  turnPlan: PlotLabTurnPlan;
  allowedNextMove: string;
  forbiddenMoves: string[];
}

const CHARACTER_FOCUS_SEQUENCE: PlotLabFocusId[] = [
  "protagonist",
  "primary_counterpart",
  "operator_pressure",
  "relationship_core",
];

const FOCUS_LABELS: Record<PlotLabFocusId, string> = {
  opening: "opening read",
  protagonist: "protagonist",
  primary_counterpart: "primary counterpart / gravity character",
  operator_pressure: "operator / pressure face",
  relationship_core: "core relationship/pressure chain",
  plot: "plot",
};

const FOCUS_TYPES: Record<PlotLabFocusId, PlotLabFocusType> = {
  opening: "opening",
  protagonist: "protagonist",
  primary_counterpart: "character",
  operator_pressure: "character",
  relationship_core: "relationship",
  plot: "plot",
};

const ROLE_SLOT_INSTRUCTIONS: Record<PlotLabRoleSlot, string> = {
  protagonist: "the character whose want, future, or protected self is most directly threatened by EP1",
  primary_counterpart: "the person whose attention, desire, threat, support, status, or disruption most changes the protagonist's life",
  operator_pressure: "the person who delivers, enforces, translates, or operationalizes the world pressure; optional if pressure comes directly from the counterpart or world",
  world_force: "the institution, family, class system, organization, place, or social force creating pressure; summarize only unless the writer asks for a pass",
};

const ROLE_FOCUS_IDS = new Set<PlotLabFocusId>([
  "protagonist",
  "primary_counterpart",
  "operator_pressure",
]);

function initialRoleSlots(): PlotLabRoleSlotStatuses {
  return {
    protagonist: "identified",
    primary_counterpart: "identified",
    operator_pressure: "identified",
    world_force: "identified",
  };
}

export function isFirstReadConfirmation(text: string): boolean {
  return /^(yes,?\s*)?(this is right|reading is right|read is right|looks right|correct)$/i.test(text.trim());
}

export function isAddContextSubmission(text: string): boolean {
  return /^The writer is adding context before Levi continues\./i.test(text.trim());
}

export function createInitialPlotLabControllerState(): PlotLabControllerState {
  return buildState({
    phase: "opening_read",
    focusId: "opening",
    focusIndex: -1,
    questionsInFocus: 0,
    maxQuestionsPerFocus: 2,
    completedFocuses: [],
    checkpointPending: false,
    assistantTurnKind: "opening_read",
    lastUserIntent: "normal",
    skipCount: 0,
    roleSlots: initialRoleSlots(),
    pendingRoleClarification: null,
    monetizationStatus: "unclear",
    questionVector: "evidence_read",
    questionMode: "fixed_actions",
  });
}

export function classifyPlotLabUserIntent(text: string, state?: Pick<PlotLabControllerState, "waitingFor" | "questionMode" | "assistantTurnKind">): PlotLabUserIntent {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return "normal";
  if (isFirstReadConfirmation(text)) return "confirm_opening";
  if (isAddContextSubmission(text) || /^add context$/i.test(text.trim())) return "add_context";
  if (/\b(therapy|therapist|headache|same question|repeated|repetitive|too similar|stop asking this|bad question|not fun|annoying)\b/.test(normalized)) {
    return "quality_feedback";
  }
  if (/^(whatever|whate?ver|idk|i don'?t know|dunno|not sure|hmm|meh|yes|yeah|yep|ok|okay|go ahead|go aehad|fine|sure)$/i.test(text.trim())) {
    if (state?.waitingFor === "approve_lock") return "lock_current";
    if (state?.waitingFor === "move_on") return "move_into_plot";
    if (state?.assistantTurnKind === "opening_read" && /^(yes|yeah|yep|ok|okay)$/i.test(text.trim())) return "confirm_opening";
    return "low_signal";
  }
  if (/move (to )?(the )?next|next character|different character|move on|let'?s move on|no,?\s*move on/.test(normalized)) {
    return "move_next";
  }
  if (/different angle|different question|another angle|ask another|ask something else/.test(normalized)) {
    return "different_angle";
  }
  if (/first plot beat|move into plot|start plot|plot beat|into the first plot/.test(normalized)) {
    return "move_into_plot";
  }
  if (/lock( this)?|approve|save this|lock and move on/.test(normalized)) {
    return "lock_current";
  }
  if (/continue here|stay here|one more|keep going here/.test(normalized)) {
    return "continue_here";
  }
  if (/revise|edit this|adjust this/.test(normalized)) {
    return "revise_current";
  }
  if (/reroll|new options|try again|another set|different options/.test(normalized)) {
    return "reroll_options";
  }
  if (/skip (this )?(role|character|slot)|leave (it )?blank|not introduced|not present|no separate|none yet|no one yet|not clear yet/.test(normalized)) {
    return "skip_role";
  }
  if (/skip (the )?(monetization|paywall)|no paywall yet|paywall later|leave (monetization|paywall) blank/.test(normalized)) {
    return "skip_monetization";
  }
  if (/stay (at|with).*character|character level|relationship level|not plot yet/.test(normalized)) {
    return "stay_character";
  }
  if (/skip|step back|too narrow|simpler|not useful|don'?t drill|stop drilling/.test(normalized)) {
    return "skip_or_too_narrow";
  }
  return "normal";
}

export function planPlotLabAssistantTurn(
  previousState: PlotLabControllerState,
  prompt: string
): PlotLabControllerState {
  const intent = classifyPlotLabUserIntent(prompt, previousState);
  const skipCount = intent === "skip_or_too_narrow" || intent === "quality_feedback" ? previousState.skipCount + 1 : previousState.skipCount;

  if (previousState.phase === "stage_1_complete") {
    return buildState({
      ...previousState,
      assistantTurnKind: "stage_1_complete",
      lastUserIntent: intent,
      skipCount,
      questionVector: "lock_review",
      questionMode: "typed",
    });
  }

  if (previousState.phase === "opening_read") {
    if (intent === "confirm_opening" || intent === "add_context") {
      return buildState({
        ...previousState,
        phase: "protagonist_discovery",
        focusId: "protagonist",
        focusIndex: 0,
        questionsInFocus: 0,
        checkpointPending: false,
        assistantTurnKind: "discovery_question",
        lastUserIntent: intent,
        skipCount,
        questionVector: "character_anchor",
        questionMode: "typed",
      });
    }

    return buildState({
      ...previousState,
      assistantTurnKind: "opening_read",
      lastUserIntent: intent,
      skipCount,
      questionVector: "evidence_read",
      questionMode: "fixed_actions",
    });
  }

  if (intent === "move_into_plot") {
    return buildState({
      ...previousState,
      phase: "monetization_discovery",
      focusId: "plot",
      focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
      checkpointPending: false,
      assistantTurnKind: "monetization_bridge",
      lastUserIntent: intent,
      skipCount,
      monetizationStatus: previousState.monetizationStatus === "locked" ? "locked" : "unclear",
      questionVector: "monetization_endpoint",
      questionMode: "typed",
    });
  }

  if (intent === "lock_current") {
    if (previousState.phase === "plot_transition_gate") {
      return buildState({
        ...previousState,
        phase: "monetization_discovery",
        focusId: "plot",
        focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
        checkpointPending: false,
        assistantTurnKind: "monetization_bridge",
        lastUserIntent: intent,
        skipCount,
        monetizationStatus: previousState.monetizationStatus === "locked" ? "locked" : "unclear",
        questionVector: "monetization_endpoint",
        questionMode: "typed",
      });
    }

    if (previousState.phase === "monetization_lock_review") {
      return buildState({
        ...previousState,
        phase: "premise_bridge",
        focusId: "plot",
        focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
        checkpointPending: false,
        assistantTurnKind: "premise_bridge",
        lastUserIntent: intent,
        skipCount,
        monetizationStatus: "locked",
        questionVector: "monetization_delta",
        questionMode: "typed",
      });
    }

    if (previousState.phase === "premise_bridge") {
      return buildState({
        ...previousState,
        phase: "stage_1_complete",
        focusId: "plot",
        focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
        checkpointPending: false,
        assistantTurnKind: "stage_1_complete",
        lastUserIntent: intent,
        skipCount,
        questionVector: "lock_review",
        questionMode: "typed",
      });
    }

    return planNextFocus(previousState, intent, skipCount);
  }

  if (intent === "continue_here" || intent === "revise_current") {
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      questionsInFocus: Math.max(0, previousState.maxQuestionsPerFocus - 1),
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: broadenedQuestionVector(previousState),
      questionMode: "typed",
    });
  }

  if (intent === "quality_feedback" || intent === "low_signal") {
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: intent === "quality_feedback" ? broadenedQuestionVector(previousState) : previousState.questionVector,
      questionMode: "typed",
    });
  }

  if (previousState.phase === "monetization_discovery" && /option|suggest|give me|show me|ideas/i.test(prompt)) {
    return buildState({
      ...previousState,
      phase: "monetization_discovery",
      focusId: "plot",
      focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
      checkpointPending: false,
      assistantTurnKind: "monetization_bridge",
      lastUserIntent: intent,
      skipCount,
      monetizationStatus: "unclear",
      questionVector: "monetization_endpoint",
      questionMode: "requested_options",
    });
  }

  if (previousState.phase === "monetization_discovery") {
    const monetizationStatus: PlotLabSlotStatus = intent === "skip_monetization" || intent === "skip_role"
      ? "skipped"
      : "unclear";
    return buildState({
      ...previousState,
      phase: "monetization_lock_review",
      focusId: "plot",
      focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
      checkpointPending: true,
      assistantTurnKind: "monetization_review",
      lastUserIntent: intent,
      skipCount,
      monetizationStatus,
      questionVector: "lock_review",
      questionMode: "fixed_actions",
    });
  }

  if (previousState.phase === "premise_bridge") {
    return buildState({
      ...previousState,
      phase: "premise_bridge",
      focusId: "plot",
      focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
      checkpointPending: true,
      assistantTurnKind: "premise_bridge",
      lastUserIntent: intent,
      skipCount,
      questionVector: "lock_review",
      questionMode: "fixed_actions",
    });
  }

  if (previousState.phase === "monetization_lock_review") {
    return buildState({
      ...previousState,
      phase: "monetization_lock_review",
      focusId: "plot",
      focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
      checkpointPending: true,
      assistantTurnKind: "monetization_review",
      lastUserIntent: intent,
      skipCount,
      monetizationStatus: "unclear",
      questionVector: "lock_review",
      questionMode: "fixed_actions",
    });
  }

  if (intent === "skip_role") {
    return skipCurrentRole(previousState, intent, skipCount);
  }

  if (intent === "stay_character") {
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      questionsInFocus: Math.min(previousState.questionsInFocus, previousState.maxQuestionsPerFocus - 1),
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: nextDiscoveryQuestionVector(previousState),
      questionMode: "typed",
    });
  }

  if (intent === "move_next") {
    return planNextFocus(previousState, intent, skipCount);
  }

  if (intent === "different_angle" || intent === "skip_or_too_narrow") {
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      questionsInFocus: previousState.maxQuestionsPerFocus - 1,
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: broadenedQuestionVector(previousState),
      questionMode: "typed",
    });
  }

  if (previousState.checkpointPending || previousState.questionsInFocus >= previousState.maxQuestionsPerFocus) {
    if (previousState.focusId === "relationship_core") {
      return buildState({
        ...previousState,
        phase: "plot_transition_gate",
        checkpointPending: true,
        assistantTurnKind: "character_board_summary",
        lastUserIntent: intent,
        skipCount,
        questionVector: "lock_review",
        questionMode: "fixed_actions",
      });
    }

    return buildState({
      ...previousState,
      phase: "character_summary",
      checkpointPending: true,
      assistantTurnKind: "checkpoint_summary",
      lastUserIntent: intent,
      skipCount,
      questionVector: "lock_review",
        questionMode: "fixed_actions",
      });
  }

  return buildState({
    ...previousState,
    phase: phaseForFocus(previousState.focusId),
    checkpointPending: false,
    assistantTurnKind: "discovery_question",
    lastUserIntent: intent,
    skipCount,
    questionVector: nextDiscoveryQuestionVector(previousState),
    questionMode: "typed",
  });
}

export function commitPlotLabAssistantTurn(state: PlotLabControllerState): PlotLabControllerState {
  if (state.assistantTurnKind !== "discovery_question" && state.assistantTurnKind !== "transition_next_focus") {
    return state;
  }
  if (state.lastUserIntent === "quality_feedback" || state.lastUserIntent === "low_signal" || state.lastUserIntent === "skip_or_too_narrow") {
    return state;
  }

  const questionsInFocus = Math.min(state.maxQuestionsPerFocus, state.questionsInFocus + 1);

  return buildState({
    ...state,
    questionsInFocus,
    checkpointPending: questionsInFocus >= state.maxQuestionsPerFocus,
  });
}

export function renderPlotLabControllerDirective(state: PlotLabControllerState): string {
  const roleStatus = Object.entries(state.roleSlots)
    .map(([slot, status]) => `${slot}: ${status}`)
    .join(", ");
  const currentRoleInstruction = isRoleFocus(state.focusId)
    ? ROLE_SLOT_INSTRUCTIONS[state.focusId]
    : state.focusId === "relationship_core"
      ? "connect the completed role slots into a light relationship/pressure chain"
      : "none";

  return [
    "## Plot Lab Controller State",
    "This block is app-owned policy. Follow it over softer prompt preferences.",
    `- Planned assistant turn kind: ${state.assistantTurnKind}`,
    `- Phase: ${state.phase}`,
    `- Current focus: ${state.currentFocus} (${state.focusType})`,
    `- Current role-slot instruction: ${currentRoleInstruction}`,
    `- Role slot statuses: ${roleStatus}`,
    `- Pending role clarification: ${state.pendingRoleClarification ?? "none"}`,
    `- Monetization/paywall status: ${state.monetizationStatus}`,
    `- Question vector: ${state.questionVector}`,
    `- Framework slot: ${state.frameworkSlot}`,
    `- Current-focus question count before this answer: ${state.questionsInFocus} / ${state.maxQuestionsPerFocus}`,
    `- Completed focuses: ${state.completedFocuses.length ? state.completedFocuses.map((focus) => FOCUS_LABELS[focus]).join(", ") : "none"}`,
    `- Checkpoint pending: ${state.checkpointPending ? "yes" : "no"}`,
    `- Last user intent: ${state.lastUserIntent}`,
    `- Recent skip/different-question count: ${state.skipCount}`,
    `- Question mode: ${state.turnPlan.questionMode}`,
    `- Allow model options: ${state.turnPlan.allowModelOptions ? "yes" : "no"}`,
    `- UI actions: ${state.turnPlan.actions.length ? state.turnPlan.actions.map((action) => `${action.kind}:${action.label}`).join(" | ") : "none"}`,
    `- Waiting for: ${state.waitingFor}`,
    `- Plot-detail questions allowed: ${state.plotDetailAllowed ? "yes" : "no"}`,
    `- Allowed next move: ${state.allowedNextMove}`,
    `- Forbidden moves: ${state.forbiddenMoves.join(" | ")}`,
    "- If turn kind is opening_read: give the EP1 read and ask the fixed confirmation question only.",
    "- If turn kind is discovery_question: ask exactly one open, EP1-grounded question for the current focus and question vector. Make it inviting, simple, and story-useful. If this is question 2, change vector from the prior question instead of drilling the same internal axis. When Allow model options is yes, use structured answer-starter options as scaffolds, not canon locks.",
    "- If turn kind is checkpoint_summary: summarize the current focus in 2-3 sentences. Do not ask a new discovery question; the app renders fixed controls.",
    "- If turn kind is transition_next_focus: bridge in one sentence, then ask the first open discovery question for the new generic role slot. Do not choose a different character role than the controller focus.",
    "- If turn kind is character_board_summary: summarize protagonist + primary counterpart + operator/world pressure + relationship/core in 2-4 sentences and ask whether to move into plot/monetization or stay at character level. The app renders fixed controls.",
    "- If turn kind is monetization_bridge: summarize the EP1 big thread, character soul board, and relationship/pressure chain, then ask exactly one open monetization/paywall-point question. Return structured endpoint options only when Allow model options is yes. Do not ask a first plot beat or scene-mechanics question yet.",
    "- If turn kind is monetization_review: restate the current monetization candidate in one sentence and ask for approval, revision, or reroll. Do not move into plot runway yet.",
    "- If turn kind is premise_bridge and Framework slot is earned_change: treat the monetization point as a later point in time. Ask one open universe/pressure/delta question about what must become true before the endpoint feels earned. Do not ask for first-beat tactics yet.",
    "- If turn kind is premise_bridge and Framework slot is lock_review: do not ask a new discovery question. Restate the bridge candidate compactly so the app-owned lock/revise/reroll controls can handle the next action.",
    "- If turn kind is stage_1_complete: state that Stage 1 is locked through monetization and stop. Do not propose beats, runway, Episode 2, episode sketches, or next scene mechanics.",
    "- If turn kind is plot_gate: build the episode runway only after the monetization/paywall point and premise bridge have been approved. Do not use Day 1 / Day 2 framing unless the writer explicitly asks for it as scratch brainstorming.",
    "- Scope answers to the question just asked. Do not globalize a local answer into the whole story engine.",
    "- If the current role slot seems missing, ask the writer to explain it briefly or say it can stay blank. If it stays blank, do not invent it.",
    "- If the writer mentions a person/role that is not clearly mapped, ask the smallest entity-resolution clarification before reasoning from it. If the writer moves on, leave that fact unresolved and do not use it as canon.",
    "- Do not hardcode or assume story-specific identities. Map names from the source/chat into the generic role slots only when the source or writer makes the mapping clear.",
    "- Do not revive stale alternative canon once the writer has confirmed a specific version, unless the writer explicitly reopens it.",
  ].join("\n");
}

function planNextFocus(
  previousState: PlotLabControllerState,
  intent: PlotLabUserIntent,
  skipCount: number
): PlotLabControllerState {
  const existingRoleStatus = isRoleFocus(previousState.focusId)
    ? previousState.roleSlots[previousState.focusId]
    : null;
  const roleSlots = existingRoleStatus === "skipped" || existingRoleStatus === "not_present"
    ? previousState.roleSlots
    : markCurrentRole(previousState, "locked");
  const completedFocuses = previousState.completedFocuses.includes(previousState.focusId) ||
    previousState.focusId === "opening" ||
    previousState.focusId === "plot"
      ? previousState.completedFocuses
      : [...previousState.completedFocuses, previousState.focusId];
  const nextFocusIndex = previousState.focusIndex + 1;
  const nextFocusId = CHARACTER_FOCUS_SEQUENCE[nextFocusIndex] ?? "plot";

  if (nextFocusId === "plot") {
    return buildState({
      ...previousState,
      phase: "plot_transition_gate",
      focusId: "plot",
      focusIndex: CHARACTER_FOCUS_SEQUENCE.length,
      questionsInFocus: 0,
      roleSlots,
      completedFocuses,
      checkpointPending: true,
      assistantTurnKind: "character_board_summary",
      lastUserIntent: intent,
      skipCount,
      questionVector: "lock_review",
      questionMode: "fixed_actions",
    });
  }

  return buildState({
    ...previousState,
    phase: phaseForFocus(nextFocusId),
    focusId: nextFocusId,
    focusIndex: nextFocusIndex,
    questionsInFocus: 0,
    roleSlots,
    pendingRoleClarification: null,
    completedFocuses,
    checkpointPending: false,
    assistantTurnKind: "transition_next_focus",
    lastUserIntent: intent,
    skipCount,
    questionVector: firstQuestionVectorForFocus(nextFocusId),
    questionMode: "typed",
  });
}

function skipCurrentRole(
  previousState: PlotLabControllerState,
  intent: PlotLabUserIntent,
  skipCount: number
): PlotLabControllerState {
  if (!isRoleFocus(previousState.focusId)) {
    return buildState({
      ...previousState,
      lastUserIntent: intent,
      skipCount,
    });
  }

  return planNextFocus(
    buildState({
      ...previousState,
      roleSlots: markCurrentRole(previousState, "skipped"),
      questionsInFocus: previousState.maxQuestionsPerFocus,
      checkpointPending: true,
      lastUserIntent: intent,
      skipCount,
    }),
    intent,
    skipCount
  );
}

type PlotLabStateInput = Omit<PlotLabControllerState, "focusType" | "currentFocus" | "frameworkSlot" | "waitingFor" | "plotDetailAllowed" | "turnPlan" | "allowedNextMove" | "forbiddenMoves">;
type PlotLabPlannedStateInput = PlotLabStateInput & { frameworkSlot: PlotLabFrameworkSlot };

function frameworkSlotForState(state: PlotLabStateInput): PlotLabFrameworkSlot {
  if (state.assistantTurnKind === "opening_read") return "opening_read";
  if (state.assistantTurnKind === "stage_1_complete") return "stage_1_complete";
  if (state.questionVector === "lock_review") return "lock_review";
  if (state.questionVector === "monetization_endpoint") return "paid_image";
  if (state.questionVector === "monetization_delta") return "earned_change";
  if (state.focusId === "protagonist") {
    return state.questionsInFocus <= 0 ? "screen_promise" : "world_effect";
  }
  if (state.focusId === "primary_counterpart") {
    return state.questionsInFocus <= 0 ? "relationship_conversion" : "new_door_new_cost";
  }
  if (state.focusId === "operator_pressure") {
    return state.questionsInFocus <= 0 ? "pressure_style" : "power_rule";
  }
  if (state.focusId === "relationship_core") {
    return state.questionsInFocus <= 0 ? "arena" : "engine_secret";
  }
  return "lock_review";
}

function buildState(input: PlotLabStateInput): PlotLabControllerState {
  const focusType = FOCUS_TYPES[input.focusId];
  const stage2Enabled = process.env.NEXT_PUBLIC_PLOT_LAB_STAGE2_ENABLED === "true";
  const plotDetailAllowed = stage2Enabled && (input.assistantTurnKind === "plot_gate" || input.phase === "plot_thread");
  const frameworkSlot = frameworkSlotForState(input);
  const plannedInput = { ...input, frameworkSlot };
  const turnPlan = buildTurnPlan(plannedInput);

  return {
    ...plannedInput,
    focusType,
    currentFocus: FOCUS_LABELS[input.focusId],
    waitingFor: waitingFor(input),
    plotDetailAllowed,
    turnPlan,
    allowedNextMove: allowedNextMove(plannedInput),
    forbiddenMoves: forbiddenMoves(plannedInput, plotDetailAllowed),
  };
}

const CUSTOM_ANSWER_ACTION: PlotLabAction = {
  actionId: "custom_answer",
  kind: "custom_answer",
  label: "Write my own answer",
  detail: "Type directly into chat instead.",
  response: "Write my own answer",
};

const CONFIRM_OPENING_ACTIONS: PlotLabAction[] = [
  {
    actionId: "confirm_opening",
    kind: "confirm_opening",
    label: "Yes, this is right",
    detail: "Start the Stage 1 protagonist pass.",
    response: "Yes, this is right",
  },
  {
    actionId: "add_context",
    kind: "add_context",
    label: "Add context",
    detail: "Add or correct source context before Levi continues.",
    response: "Add context",
  },
];

const LOCK_REVIEW_ACTIONS: PlotLabAction[] = [
  {
    actionId: "lock_current",
    kind: "lock_current",
    label: "Lock and move on",
    detail: "Save this lock to Plot Lab Decisions and continue.",
    response: "Lock this",
  },
  {
    actionId: "continue_here",
    kind: "continue_here",
    label: "Continue here",
    detail: "Ask one broader question before moving on.",
    response: "Continue here",
  },
  {
    actionId: "revise_current",
    kind: "revise_current",
    label: "Revise",
    detail: "Use my next note to adjust this lock.",
    response: "Revise this",
  },
];

const PLOT_GATE_ACTIONS: PlotLabAction[] = [
  {
    actionId: "lock_current",
    kind: "lock_current",
    label: "Lock and move on",
    detail: "Save the character board and move into monetization.",
    response: "Lock this",
  },
  {
    actionId: "move_into_plot",
    kind: "move_into_plot",
    label: "Move into plot",
    detail: "Use the character board to find the monetization point.",
    response: "Move into plot",
  },
  {
    actionId: "stay_character",
    kind: "stay_character",
    label: "Stay with character",
    detail: "Keep refining character, relationship, or world pressure.",
    response: "Stay at character level",
  },
];

const MONETIZATION_REVIEW_ACTIONS: PlotLabAction[] = [
  {
    actionId: "lock_current",
    kind: "lock_current",
    label: "Lock and move on",
    detail: "Save this endpoint or universe bridge and continue.",
    response: "Lock this",
  },
  {
    actionId: "revise_current",
    kind: "revise_current",
    label: "Revise",
    detail: "Use my next note to adjust this candidate.",
    response: "Revise this",
  },
  {
    actionId: "reroll_options",
    kind: "reroll_options",
    label: "Reroll",
    detail: "Ask Levi for a cleaner alternative angle.",
    response: "Reroll options",
  },
];

const REQUESTED_OPTION_ACTIONS: PlotLabAction[] = [
  {
    actionId: "reroll_options",
    kind: "reroll_options",
    label: "Reroll options",
    detail: "Replace this option set with a different angle.",
    response: "Reroll options",
  },
];

function withCustomAnswer(actions: PlotLabAction[]): PlotLabAction[] {
  return actions.some((action) => action.kind === "custom_answer")
    ? actions
    : [...actions, CUSTOM_ANSWER_ACTION];
}

function shouldAllowModelOptions(state: PlotLabPlannedStateInput): boolean {
  if (state.questionMode === "requested_options") return true;
  return false;
}

function buildTurnPlan(state: PlotLabPlannedStateInput): PlotLabTurnPlan {
  const allowModelOptions = shouldAllowModelOptions(state);
  let actions: PlotLabAction[] = [];

  if (state.assistantTurnKind === "stage_1_complete") {
    actions = [];
  } else if (state.questionMode === "requested_options") {
    actions = withCustomAnswer(REQUESTED_OPTION_ACTIONS);
  } else if (state.questionMode === "typed") {
    actions = withCustomAnswer([]);
  } else if (state.assistantTurnKind === "opening_read") {
    actions = withCustomAnswer(CONFIRM_OPENING_ACTIONS);
  } else if (state.assistantTurnKind === "character_board_summary") {
    actions = withCustomAnswer(PLOT_GATE_ACTIONS);
  } else if (state.assistantTurnKind === "monetization_review" || state.assistantTurnKind === "premise_bridge") {
    actions = withCustomAnswer(MONETIZATION_REVIEW_ACTIONS);
  } else {
    actions = withCustomAnswer(LOCK_REVIEW_ACTIONS);
  }

  return {
    turnKind: state.assistantTurnKind,
    phase: state.phase,
    focus: state.focusId,
    questionVector: state.questionVector,
    frameworkSlot: state.frameworkSlot,
    questionMode: state.questionMode,
    actions,
    allowModelOptions,
  };
}

function phaseForFocus(focusId: PlotLabFocusId): PlotLabConversationPhase {
  if (focusId === "protagonist") return "protagonist_discovery";
  if (focusId === "primary_counterpart" || focusId === "operator_pressure") return "character_discovery";
  if (focusId === "relationship_core") return "relationship_discovery";
  if (focusId === "plot") return "plot_transition_gate";
  return "opening_read";
}

function firstQuestionVectorForFocus(focusId: PlotLabFocusId): PlotLabQuestionVector {
  if (focusId === "protagonist") return "character_anchor";
  if (focusId === "primary_counterpart") return "relationship_function";
  if (focusId === "operator_pressure") return "power_language";
  if (focusId === "relationship_core") return "world_pressure";
  return "character_anchor";
}

function secondQuestionVectorForFocus(focusId: PlotLabFocusId): PlotLabQuestionVector {
  if (focusId === "protagonist") return "spark_in_world";
  if (focusId === "primary_counterpart") return "choice_space";
  if (focusId === "operator_pressure") return "world_rule";
  if (focusId === "relationship_core") return "unresolved_ecology";
  return "external_pressure";
}

function nextDiscoveryQuestionVector(state: Pick<PlotLabControllerState, "focusId" | "questionsInFocus">): PlotLabQuestionVector {
  return state.questionsInFocus <= 0
    ? firstQuestionVectorForFocus(state.focusId)
    : secondQuestionVectorForFocus(state.focusId);
}

function broadenedQuestionVector(state: Pick<PlotLabControllerState, "focusId" | "questionVector">): PlotLabQuestionVector {
  if (state.questionVector === "character_anchor") return "spark_in_world";
  if (state.questionVector === "spark_in_world") return "world_pressure";
  if (state.questionVector === "relationship_function") return "choice_space";
  if (state.questionVector === "choice_space") return "world_pressure";
  if (state.questionVector === "power_language") return "world_rule";
  if (state.questionVector === "external_pressure") return "world_pressure";
  if (state.questionVector === "world_pressure") return "unresolved_ecology";
  return state.questionVector;
}

function allowedNextMove(state: PlotLabPlannedStateInput): string {
  if (state.assistantTurnKind === "opening_read") {
    return "Give a 3-4 sentence EP1 grounding read, then ask if the reading is correct or if the writer wants to add context.";
  }
  if (state.assistantTurnKind === "checkpoint_summary") {
    return "Stop drilling this focus. Summarize the working lock in 2-3 sentences. The app will offer Move to next character / Ask different angle.";
  }
  if (state.assistantTurnKind === "transition_next_focus") {
    return `Move to ${FOCUS_LABELS[state.focusId]} and ask the first open EP1-grounded discovery question for that focus.`;
  }
  if (state.assistantTurnKind === "character_board_summary") {
    return "Summarize the character board and ask whether to move into plot/monetization or stay at character/relationship level.";
  }
  if (state.assistantTurnKind === "monetization_bridge") {
    return "Summarize EP1 big thread + character soul board + relationship/pressure chain, then ask what the monetization/paywall point should be. No first plot beat yet.";
  }
  if (state.assistantTurnKind === "premise_bridge" && state.frameworkSlot === "lock_review") {
    return "Restate the universe/premise bridge candidate in 1-2 sentences and wait for Lock / Revise / Reroll. Do not ask another bridge or outside-force question.";
  }
  if (state.assistantTurnKind === "premise_bridge") {
    return "Zoom out from EP1 to the later monetization point. Ask what story-world, pressure, power, or character-condition shift makes the endpoint feel earned.";
  }
  if (state.assistantTurnKind === "stage_1_complete") {
    return "Stop at Stage 1 completion. Confirm the universe/character/pressure/monetization locks are ready for a later Stage 2, but do not build beats yet.";
  }
  if (state.assistantTurnKind === "monetization_review") {
    return "Restate the monetization candidate in one sentence and wait for Lock / Revise / Reroll. Do not advance to plot runway.";
  }
  if (state.assistantTurnKind === "plot_gate") {
    if (state.monetizationStatus === "skipped") {
      return "Proceed into a working first plot beat, but state that the paywall point is intentionally unresolved and do not pretend it is locked.";
    }
    return "Proceed into the first plot beat only now, grounded in the completed character/relationship context and the chosen monetization/paywall point.";
  }
  if (state.lastUserIntent === "quality_feedback") {
    return "Acknowledge the feedback briefly, drop the previous angle, and ask one simpler, more interesting Stage 1 question. Do not treat the feedback text as story canon.";
  }
  if (state.lastUserIntent === "low_signal") {
    return "The writer did not give enough story signal. Ask one easier open question from the same Stage 1 area; do not lock or infer canon from the low-signal reply.";
  }
  if (state.lastUserIntent === "skip_or_too_narrow" || state.lastUserIntent === "different_angle") {
    return "Ask a different, simpler EP1-grounded question from another angle. Do not rephrase the same question.";
  }
  if (state.questionVector === "character_anchor") {
    return "Framework slot screen_promise: ask what viewers should count on from the protagonist on screen. Keep it craft-facing, concrete, and light; no therapy language.";
  }
  if (state.questionVector === "spark_in_world") {
    return "Framework slot world_effect: ask what trouble, opportunity, or world reaction the protagonist's visible promise creates; do not turn it into another threat/status mechanics question.";
  }
  if (state.questionVector === "external_pressure") {
    return "Ask what visible pressure, status shift, public collision, or story-world trouble makes the prior answer matter on screen. Do not ask another internal-psychology variant.";
  }
  if (state.questionVector === "relationship_function") {
    return "Framework slot relationship_conversion: ask what this person becomes in the protagonist's life after EP1 changes the relationship.";
  }
  if (state.questionVector === "choice_space") {
    return "Framework slot new_door_new_cost: ask what door, access, temptation, or protection opens because of this person and what it costs. Do not repeat public status labeling.";
  }
  if (state.questionVector === "power_language") {
    return "Framework slot pressure_style: ask how this operator makes pressure visible on screen. Keep it concrete and non-therapeutic.";
  }
  if (state.questionVector === "world_rule") {
    return "Framework slot power_rule: ask what rule of power the operator's presence proves. Avoid repeating the same character-pressure question.";
  }
  if (state.questionVector === "world_pressure") {
    return "Framework slot arena: ask what larger arena EP1 opens. Do not ask what unresolved secret keeps pressure going yet.";
  }
  if (state.questionVector === "unresolved_ecology") {
    return "Framework slot engine_secret: ask what unresolved force, appetite, danger, or secret in the larger world can keep generating microdrama before monetization.";
  }
  return "Ask one open EP1-rooted discovery question. No plot mechanics yet.";
}

function waitingFor(state: PlotLabStateInput): string {
  if (state.questionMode === "requested_options") return "choose_option";
  if (state.questionMode === "fixed_actions") {
    if (state.assistantTurnKind === "opening_read") return "answer";
    if (state.assistantTurnKind === "character_board_summary") return "move_on";
    return "approve_lock";
  }
  if (state.assistantTurnKind === "discovery_question" || state.assistantTurnKind === "monetization_bridge") {
    return "answer";
  }
  if (state.assistantTurnKind === "checkpoint_summary" || state.assistantTurnKind === "monetization_review") {
    return "approve_lock";
  }
  if (state.assistantTurnKind === "character_board_summary") return "move_on";
  if (state.assistantTurnKind === "premise_bridge") return "answer";
  if (state.assistantTurnKind === "stage_1_complete") return "idle";
  if (state.assistantTurnKind === "plot_gate") return "runway_ready";
  return "idle";
}

function forbiddenMoves(
  state: PlotLabPlannedStateInput,
  plotDetailAllowed: boolean
): string[] {
  const base = [
    "Do not expose workflow labels.",
    "Do not ask more than one question.",
    "Do not invent UI buttons; the app renders them.",
    "Discovery questions should stay open and writer-led; structured options are only for explicit requested-options turns.",
  ];

  if (state.assistantTurnKind === "monetization_bridge") {
    return [
      ...base,
      "Do not ask for the first plot beat, scene tactics, counter-moves, texts/calls, deal terms, room logistics, runway, or Episode 2.",
      "Do ask for the monetization/paywall point after summarizing the EP1 thread, character soul, and pressure chain.",
      "Do not present monetization options as final endpoints unless the writer has already given specific choices.",
    ];
  }

  if (state.assistantTurnKind === "monetization_review") {
    return [
      ...base,
      "Do not ask for Day 1, Day 2, first beat, room logistics, exact counter-moves, or Episode 2.",
      "Do not mark the monetization point locked in prose; the app lock button does that.",
      "Do restate the candidate compactly and invite approval, revision, or reroll.",
    ];
  }

  if (state.assistantTurnKind === "premise_bridge") {
    if (state.frameworkSlot === "lock_review") {
      return [
        ...base,
        "Do not ask a new question.",
        "Do not ask which outside-facing force, public audience, or pressure lane matters; the writer has already answered the bridge.",
        "Do restate the candidate compactly and let the app render Lock / Revise / Reroll.",
      ];
    }
    return [
      ...base,
      "Do not ask for first plot beat tactics, room logistics, exact counter-moves, texts/calls, deal terms, or Episode 2 yet.",
      "Do not assume EP1 behavior persists unchanged until the monetization point.",
      "Do ask what changes between EP1 and the later endpoint across the story world, pressure ecology, power conditions, and character truth.",
      "Do not narrow into planted objects, specific intermediate beats, or episode-by-episode runway.",
    ];
  }

  if (state.assistantTurnKind === "stage_1_complete") {
    return [
      ...base,
      "Do not ask for first plot beat tactics, room logistics, exact counter-moves, texts/calls, deal terms, Episode 2, episode sketches, or runway.",
      "Do not offer Stage 2 beats unless the writer explicitly starts a future Stage 2 session.",
      "Do state that Stage 1 is complete through the monetization lock.",
    ];
  }

  if (plotDetailAllowed) return base;

  return [
    ...base,
    "No plot beats, scene tactics, counter-moves, texts/calls, deal terms, paywall, runway, or Episode 2.",
    "Do not announce a lock before the writer has supplied enough signal.",
    "Do not merge a newly mentioned role/name into an existing character without confirmation.",
    "Do not skip the primary counterpart role when it exists; after the protagonist, ask about the generic primary counterpart before the operator/pressure face.",
    state.questionVector === "external_pressure" || state.questionVector === "world_pressure" || state.questionVector === "spark_in_world" || state.questionVector === "choice_space" || state.questionVector === "world_rule" || state.questionVector === "unresolved_ecology"
      ? "Do not ask another therapist-style inner-refusal, wound, fear, stolen-future, moral-line, or protected-self variant; move to external pressure, story-world collision, or audience-facing consequence."
      : "Avoid therapist-style phrasing unless the writer introduced it; use craft/story language.",
    state.questionsInFocus >= state.maxQuestionsPerFocus
      ? "Do not ask another precision question for this focus; summarize/checkpoint."
      : "Do not narrow the writer into a hard fork unless there is a concrete source conflict.",
  ];
}

function isRoleFocus(focusId: PlotLabFocusId): focusId is Extract<PlotLabFocusId, PlotLabRoleSlot> {
  return ROLE_FOCUS_IDS.has(focusId);
}

function markCurrentRole(
  state: Pick<PlotLabControllerState, "focusId" | "roleSlots">,
  status: PlotLabSlotStatus
): PlotLabRoleSlotStatuses {
  if (!isRoleFocus(state.focusId)) return state.roleSlots;
  return {
    ...state.roleSlots,
    [state.focusId]: status,
  };
}
