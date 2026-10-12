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
  | "add_more_check"
  | "character_summary"
  | "plot_transition_gate"
  | "monetization_discovery"
  | "monetization_lock_review"
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
  | "add_more_check"
  | "checkpoint_summary"
  | "transition_next_focus"
  | "character_board_summary"
  | "monetization_bridge"
  | "monetization_review"
  | "stage_1_complete"
  | "plot_gate";

export type PlotLabUserIntent =
  | "confirm_opening"
  | "add_context"
  | "move_next"
  | "add_more_yes"
  | "add_more_no"
  | "add_more_context"
  | "different_angle"
  | "move_into_plot"
  | "lock_current"
  | "continue_here"
  | "revise_current"
  | "reroll_options"
  | "skip_role"
  | "skip_monetization"
  | "add_missing_detail"
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
  | "add_missing_detail"
  | "stay_character"
  | "add_more_yes"
  | "add_more_no"
  | "requested_option"
  | "reroll_options"
  | "custom_answer";

export type PlotLabQuestionVector =
  | "evidence_read"
  | "character_anchor"
  | "external_pressure"
  | "relationship_function"
  | "world_pressure"
  | "monetization_endpoint"
  | "lock_review";

export type PlotLabFrameworkSlot =
  | "opening_read"
  | "screen_promise"
  | "relationship_conversion"
  | "arena"
  | "paid_image"
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

export type PlotLabStage1BoardDisposition =
  | "focus_question"
  | "summary_only"
  | "ignore_for_now";

export interface PlotLabStage1CharacterBoardEntry {
  label: string;
  storyTerm?: "Protagonist" | "Antagonist" | "Obstacle" | "Character";
  disposition: PlotLabStage1BoardDisposition;
  rationale?: string;
  sourceEvidence?: string[];
}

export interface PlotLabStage1Focus {
  focusId: PlotLabFocusId;
  label: string;
  kind: "character" | "relationship";
  storyTerm?: PlotLabStage1CharacterBoardEntry["storyTerm"];
}

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
  stage1CharacterBoard: PlotLabStage1CharacterBoardEntry[];
  stage1FocusPlan: PlotLabStage1Focus[];
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

const CHARACTER_FOCUS_IDS: PlotLabFocusId[] = [
  "protagonist",
  "primary_counterpart",
  "operator_pressure",
];

const FOCUS_LABELS: Record<PlotLabFocusId, string> = {
  opening: "opening read",
  protagonist: "Protagonist",
  primary_counterpart: "Character",
  operator_pressure: "Character",
  relationship_core: "Main Relationship",
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
  protagonist: "the source-identified protagonist or clearest central person",
  primary_counterpart: "a source-identified key person; call them Antagonist only when the source clearly supports that role",
  operator_pressure: "a source-identified key person; do not invent a third character if the source board did not mark one",
  world_force: "the situation, institution, family, money, class, workplace, public, or social obstacle around the people",
};

const ROLE_FOCUS_IDS = new Set<PlotLabFocusId>([
  "protagonist",
  "primary_counterpart",
  "operator_pressure",
]);

function initialRoleSlots(): PlotLabRoleSlotStatuses {
  return {
    protagonist: "identified",
    primary_counterpart: "unclear",
    operator_pressure: "unclear",
    world_force: "unclear",
  };
}

const DEFAULT_STAGE1_CHARACTER_BOARD: PlotLabStage1CharacterBoardEntry[] = [
  {
    label: "Protagonist",
    storyTerm: "Protagonist",
    disposition: "focus_question",
    rationale: "Fallback when the source scan did not return a structured character board.",
  },
];

const DEFAULT_STAGE1_FOCUS_PLAN: PlotLabStage1Focus[] = [
  { focusId: "protagonist", label: "Protagonist", kind: "character", storyTerm: "Protagonist" },
  { focusId: "relationship_core", label: "Main Relationship", kind: "relationship" },
];

export function isFirstReadConfirmation(text: string): boolean {
  return /^(yes,?\s*)?(this is right|reading is right|read is right|looks right|correct)$/i.test(text.trim());
}

export function isAddContextSubmission(text: string): boolean {
  return /^The writer is adding context before Levi continues\./i.test(text.trim());
}

export function isAddMoreContextSubmission(text: string): boolean {
  return /^The writer is adding extra Stage 1 context for the current focus\./i.test(text.trim()) ||
    /^The writer is adding a missing Stage 1 detail before monetization\./i.test(text.trim());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoardDisposition(value: unknown): PlotLabStage1BoardDisposition {
  return value === "summary_only" || value === "ignore_for_now" || value === "focus_question"
    ? value
    : "summary_only";
}

function normalizeStoryTerm(value: unknown): PlotLabStage1CharacterBoardEntry["storyTerm"] | undefined {
  return value === "Protagonist" || value === "Antagonist" || value === "Obstacle" || value === "Character"
    ? value
    : undefined;
}

function displayLabelForBoardEntry(entry: PlotLabStage1CharacterBoardEntry, index: number): string {
  const label = entry.label.trim();
  if (entry.storyTerm === "Protagonist") return "Protagonist";
  if (entry.storyTerm === "Antagonist") return label && !/^antagonist$/i.test(label) ? `Antagonist: ${label}` : "Antagonist";
  if (entry.storyTerm === "Obstacle") return label || "Obstacle";
  return label || `Character ${index + 1}`;
}

function isLikelySupportingFamilyEntry(entry: PlotLabStage1CharacterBoardEntry): boolean {
  const text = `${entry.label} ${entry.rationale ?? ""}`.toLowerCase();
  return /\b(dad|father|mother|mom|mum|sister|brother|family|home|fallback|supportive)\b/.test(text);
}

function isCounterpartPromotionCandidate(entry: PlotLabStage1CharacterBoardEntry): boolean {
  if (entry.disposition === "ignore_for_now") return false;
  if (entry.storyTerm === "Protagonist" || entry.storyTerm === "Obstacle") return false;
  if (entry.storyTerm === "Antagonist") return true;
  return !isLikelySupportingFamilyEntry(entry);
}

function normalizeStage1CharacterBoard(sourceScan?: unknown): PlotLabStage1CharacterBoardEntry[] {
  if (!isPlainRecord(sourceScan) || !Array.isArray(sourceScan.stage1CharacterBoard)) {
    return DEFAULT_STAGE1_CHARACTER_BOARD;
  }

  const entries = sourceScan.stage1CharacterBoard
    .filter(isPlainRecord)
    .map((entry): PlotLabStage1CharacterBoardEntry | null => {
      const rawLabel = typeof entry.label === "string" ? entry.label.trim() : "";
      const storyTerm = normalizeStoryTerm(entry.storyTerm);
      const label = rawLabel || storyTerm || "";
      if (!label) return null;
      return {
        label,
        storyTerm,
        disposition: normalizeBoardDisposition(entry.disposition),
        rationale: typeof entry.rationale === "string" ? entry.rationale.trim() : undefined,
        sourceEvidence: Array.isArray(entry.sourceEvidence)
          ? entry.sourceEvidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 4)
          : undefined,
      };
    })
    .filter((entry): entry is PlotLabStage1CharacterBoardEntry => Boolean(entry));

  return entries.length ? entries : DEFAULT_STAGE1_CHARACTER_BOARD;
}

function createStage1FocusPlanFromBoard(board: PlotLabStage1CharacterBoardEntry[]): PlotLabStage1Focus[] {
  const focusEntries = board
    .filter((entry) => entry.disposition === "focus_question")
    .slice(0, CHARACTER_FOCUS_IDS.length);
  const promotedCounterpart =
    focusEntries.length === 1
      ? board.find((entry) => !focusEntries.includes(entry) && isCounterpartPromotionCandidate(entry))
      : null;
  const entries = (focusEntries.length ? [...focusEntries, ...(promotedCounterpart ? [promotedCounterpart] : [])] : DEFAULT_STAGE1_CHARACTER_BOARD)
    .slice(0, CHARACTER_FOCUS_IDS.length);
  const characterFocuses = entries.map((entry, index): PlotLabStage1Focus => ({
    focusId: CHARACTER_FOCUS_IDS[index] ?? "operator_pressure",
    label: displayLabelForBoardEntry(entry, index),
    kind: "character",
    storyTerm: entry.storyTerm,
  }));

  return [
    ...characterFocuses,
    { focusId: "relationship_core", label: "Main Relationship", kind: "relationship" },
  ];
}

function stage1SetupFromSourceScan(sourceScan?: unknown): Pick<PlotLabControllerState, "stage1CharacterBoard" | "stage1FocusPlan" | "roleSlots"> {
  const stage1CharacterBoard = normalizeStage1CharacterBoard(sourceScan);
  const stage1FocusPlan = createStage1FocusPlanFromBoard(stage1CharacterBoard);
  const roleSlots = initialRoleSlots();

  for (const focus of stage1FocusPlan) {
    if (isRoleFocus(focus.focusId)) {
      roleSlots[focus.focusId] = "identified";
    }
  }

  if (stage1CharacterBoard.some((entry) => entry.storyTerm === "Obstacle" || entry.disposition === "summary_only")) {
    roleSlots.world_force = "identified";
  }

  return { stage1CharacterBoard, stage1FocusPlan, roleSlots };
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
    stage1CharacterBoard: DEFAULT_STAGE1_CHARACTER_BOARD,
    stage1FocusPlan: DEFAULT_STAGE1_FOCUS_PLAN,
    monetizationStatus: "unclear",
    questionVector: "evidence_read",
    questionMode: "fixed_actions",
  });
}

export function classifyPlotLabUserIntent(text: string, state?: Pick<PlotLabControllerState, "waitingFor" | "questionMode" | "assistantTurnKind">): PlotLabUserIntent {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return "normal";
  if (isFirstReadConfirmation(text)) return "confirm_opening";
  if (isAddMoreContextSubmission(text)) return "add_more_context";
  if (isAddContextSubmission(text) || /^add context$/i.test(text.trim())) return "add_context";
  if (state?.waitingFor === "add_more") {
    if (/^(no|nope|nothing|nothing else|done|move on)$/i.test(text.trim())) return "add_more_no";
    if (/^(yes|yeah|yep|add more|i want to add more)$/i.test(text.trim())) return "add_more_yes";
  }
  if (/\b(therapy|therapist|headache|same question|repeated|repetitive|too similar|stop asking this|bad question|not fun|annoying|figure it out|have to do everything|why are you here|what'?s the point of you)\b/.test(normalized)) {
    return "quality_feedback";
  }
  if (/^(whatever|whate?ver|idk|i don'?t know|dunno|no idea|not sure|hmm|meh|yes|yeah|yep|ok|okay|go ahead|go aehad|fine|sure)$/i.test(text.trim())) {
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
  if (/add missing|missing detail|missed detail|anything important|add.*(character|relationship|world|plot thread)/.test(normalized)) {
    return "add_missing_detail";
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
  prompt: string,
  sourceScan?: unknown
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
      const stage1Setup = stage1SetupFromSourceScan(sourceScan);
      const firstFocus = stage1Setup.stage1FocusPlan[0] ?? DEFAULT_STAGE1_FOCUS_PLAN[0];
      return buildState({
        ...previousState,
        ...stage1Setup,
        phase: phaseForFocus(firstFocus.focusId),
        focusId: firstFocus.focusId,
        focusIndex: 0,
        questionsInFocus: 0,
        maxQuestionsPerFocus: 1,
        checkpointPending: false,
        assistantTurnKind: "discovery_question",
        lastUserIntent: intent,
        skipCount,
        questionVector: firstQuestionVectorForFocus(firstFocus.focusId),
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
      focusIndex: previousState.stage1FocusPlan.length,
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
        focusIndex: previousState.stage1FocusPlan.length,
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
        phase: "stage_1_complete",
        focusId: "plot",
        focusIndex: previousState.stage1FocusPlan.length,
        checkpointPending: false,
        assistantTurnKind: "stage_1_complete",
        lastUserIntent: intent,
        skipCount,
        monetizationStatus: "locked",
        questionVector: "lock_review",
        questionMode: "typed",
      });
    }

    if (previousState.phase === "add_more_check") {
      return planNextFocus(previousState, intent, skipCount);
    }

    return planNextFocus(previousState, intent, skipCount);
  }

  if (intent === "continue_here" || intent === "revise_current") {
    if (previousState.checkpointPending || previousState.phase === "add_more_check") {
      return buildAddMoreCheckState(previousState, intent, skipCount);
    }
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      questionsInFocus: 0,
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: firstQuestionVectorForFocus(previousState.focusId),
      questionMode: "typed",
    });
  }

  if (intent === "quality_feedback" || intent === "low_signal") {
    if (previousState.checkpointPending || previousState.phase === "add_more_check") {
      return buildAddMoreCheckState(previousState, intent, skipCount);
    }
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: firstQuestionVectorForFocus(previousState.focusId),
      questionMode: "typed",
    });
  }

  if (previousState.phase === "monetization_discovery" && /option|suggest|give me|show me|ideas/i.test(prompt)) {
    return buildState({
      ...previousState,
      phase: "monetization_discovery",
      focusId: "plot",
      focusIndex: previousState.stage1FocusPlan.length,
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
      focusIndex: previousState.stage1FocusPlan.length,
      checkpointPending: true,
      assistantTurnKind: "monetization_review",
      lastUserIntent: intent,
      skipCount,
      monetizationStatus,
      questionVector: "lock_review",
      questionMode: "fixed_actions",
    });
  }

  if (previousState.phase === "monetization_lock_review") {
    return buildState({
      ...previousState,
      phase: "monetization_lock_review",
      focusId: "plot",
      focusIndex: previousState.stage1FocusPlan.length,
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

  if (intent === "stay_character" || intent === "add_missing_detail") {
    if (previousState.checkpointPending || previousState.phase === "add_more_check") {
      return buildAddMoreCheckState(previousState, intent, skipCount);
    }
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      questionsInFocus: 0,
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: firstQuestionVectorForFocus(previousState.focusId),
      questionMode: "typed",
    });
  }

  if (intent === "move_next") {
    return planNextFocus(previousState, intent, skipCount);
  }

  if (intent === "different_angle" || intent === "skip_or_too_narrow") {
    if (previousState.checkpointPending || previousState.phase === "add_more_check") {
      return buildAddMoreCheckState(previousState, intent, skipCount);
    }
    return buildState({
      ...previousState,
      phase: phaseForFocus(previousState.focusId),
      checkpointPending: false,
      questionsInFocus: 0,
      assistantTurnKind: "discovery_question",
      lastUserIntent: intent,
      skipCount,
      questionVector: firstQuestionVectorForFocus(previousState.focusId),
      questionMode: "typed",
    });
  }

  if (previousState.checkpointPending || previousState.questionsInFocus >= previousState.maxQuestionsPerFocus) {
    if (intent === "add_more_no" || intent === "add_more_context") {
      return planNextFocus(previousState, intent, skipCount);
    }
    return buildAddMoreCheckState(previousState, intent, skipCount);
  }

  return buildState({
    ...previousState,
    phase: phaseForFocus(previousState.focusId),
    checkpointPending: false,
    assistantTurnKind: "discovery_question",
    lastUserIntent: intent,
    skipCount,
    questionVector: firstQuestionVectorForFocus(previousState.focusId),
    questionMode: "typed",
  });
}

function buildAddMoreCheckState(
  previousState: PlotLabControllerState,
  intent: PlotLabUserIntent,
  skipCount: number
): PlotLabControllerState {
  return buildState({
    ...previousState,
    phase: "add_more_check",
    checkpointPending: true,
    assistantTurnKind: "add_more_check",
    lastUserIntent: intent,
    skipCount,
    questionVector: "lock_review",
    questionMode: "fixed_actions",
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
  const focusPlan = state.stage1FocusPlan
    .map((focus, index) => `${index + 1}. ${focus.label}`)
    .join(" -> ");
  const sourceBoard = state.stage1CharacterBoard
    .map((entry) => `${entry.label}: ${entry.disposition}${entry.storyTerm ? ` (${entry.storyTerm})` : ""}`)
    .join(", ");
  const currentRoleInstruction = isRoleFocus(state.focusId)
    ? ROLE_SLOT_INSTRUCTIONS[state.focusId]
    : state.focusId === "relationship_core"
      ? "connect the completed source-led people and situation into the main relationship engine"
      : "none";

  return [
    "## Plot Lab Controller State",
    "This block is app-owned policy. Follow it over softer prompt preferences.",
    `- Planned assistant turn kind: ${state.assistantTurnKind}`,
    `- Phase: ${state.phase}`,
    `- Current focus: ${state.currentFocus} (${state.focusType})`,
    `- Source-led Stage 1 focus plan: ${focusPlan || "fallback protagonist -> main relationship"}`,
    `- Source-led character board: ${sourceBoard || "fallback protagonist only"}`,
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
    "- If turn kind is discovery_question: ask exactly one open, EP1-grounded question for the current focus. Make it inviting, simple, and story-useful. When Allow model options is yes, return exactly 2 structured answer-starter options as scaffolds, not canon locks.",
    "- If structured answer-starter options are allowed: make the two options distinct story levers, not two phrasings of the same status/pressure/optics idea. One may sharpen the question's angle; the other should open a different supported route.",
    "- If turn kind is add_more_check: ask only this fixed lightweight check: Anything else about the current focus you want to add? Do not ask a deeper craft question.",
    "- If turn kind is checkpoint_summary: summarize the current focus in 2-3 sentences. Do not ask a new discovery question; the app renders fixed controls.",
    "- If turn kind is transition_next_focus: bridge in one sentence, then ask the one open discovery question for the controller's current source-led focus. Do not invent an extra character.",
    "- If turn kind is character_board_summary: summarize the source-led people, obstacle/situation if any, and main relationship in 2-4 sentences and ask whether to move into the paywall question or stay at character level. The app renders fixed controls.",
    "- If turn kind is monetization_bridge: summarize the EP1 big thread, character board, and main relationship, then ask exactly one open paywall question. Return structured endpoint options only when Allow model options is yes. Do not ask a first plot beat or scene-mechanics question yet.",
    "- If turn kind is monetization_review: restate the current monetization candidate in one sentence and ask for approval, revision, or reroll. Do not move into plot runway yet.",
    "- If turn kind is stage_1_complete: state that Stage 1 is locked through monetization and stop. Do not propose beats, runway, Episode 2, episode sketches, or next scene mechanics.",
    "- If turn kind is plot_gate: build the episode runway only after the paywall point has been approved. Do not use Day 1 / Day 2 framing unless the writer explicitly asks for it as scratch brainstorming.",
    "- Scope answers to the question just asked. Do not globalize a local answer into the whole story engine.",
    "- If the current focus seems missing, let it stay blank and move on. Do not invent it.",
    "- If the writer mentions a person/role that is not clearly mapped, ask the smallest entity-resolution clarification before reasoning from it. If the writer moves on, leave that fact unresolved and do not use it as canon.",
    "- Do not hardcode or assume story-specific identities. Use names and plain story terms from the source-led board.",
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
  const nextFocus = previousState.stage1FocusPlan[nextFocusIndex] ?? null;
  const nextFocusId = nextFocus?.focusId ?? "plot";

  if (nextFocusId === "plot") {
    return buildState({
      ...previousState,
      phase: "plot_transition_gate",
      focusId: "plot",
      focusIndex: previousState.stage1FocusPlan.length,
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
    maxQuestionsPerFocus: 1,
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
  if (state.focusId === "protagonist") {
    return "screen_promise";
  }
  if (state.focusId === "primary_counterpart") {
    return "relationship_conversion";
  }
  if (state.focusId === "operator_pressure") {
    return "relationship_conversion";
  }
  if (state.focusId === "relationship_core") {
    return "arena";
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
  const dynamicFocusLabel = input.stage1FocusPlan.find((focus) => focus.focusId === input.focusId)?.label;

  return {
    ...plannedInput,
    focusType,
    currentFocus: dynamicFocusLabel ?? FOCUS_LABELS[input.focusId],
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

const ADD_MORE_ACTIONS: PlotLabAction[] = [
  {
    actionId: "add_more_no",
    kind: "add_more_no",
    label: "No",
    detail: "Move to the next Plot Lab step.",
    response: "No",
  },
  {
    actionId: "add_more_yes",
    kind: "add_more_yes",
    label: "Yes",
    detail: "Add one more note in your own words.",
    response: "Yes",
  },
];

const PLOT_GATE_ACTIONS: PlotLabAction[] = [
  {
    actionId: "lock_current",
    kind: "lock_current",
    label: "Move to monetization",
    detail: "Save the character board and move to the paywall question.",
    response: "Lock this",
  },
  {
    actionId: "add_missing_detail",
    kind: "add_missing_detail",
    label: "Add missing detail",
    detail: "Add a character, relationship, world pressure, or plot thread before monetization.",
    response: "Add missing detail",
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
  if (state.questionMode !== "typed") return false;
  if (state.frameworkSlot === "lock_review") return false;
  return (
    state.assistantTurnKind === "discovery_question" ||
    state.assistantTurnKind === "transition_next_focus" ||
    state.assistantTurnKind === "monetization_bridge"
  );
}

function buildTurnPlan(state: PlotLabPlannedStateInput): PlotLabTurnPlan {
  const allowModelOptions = shouldAllowModelOptions(state);
  let actions: PlotLabAction[] = [];

  if (state.assistantTurnKind === "stage_1_complete") {
    actions = [];
  } else if (state.assistantTurnKind === "add_more_check") {
    actions = ADD_MORE_ACTIONS;
  } else if (state.questionMode === "requested_options") {
    actions = withCustomAnswer(REQUESTED_OPTION_ACTIONS);
  } else if (state.questionMode === "typed") {
    actions = withCustomAnswer(state.assistantTurnKind === "monetization_bridge" ? REQUESTED_OPTION_ACTIONS : []);
  } else if (state.assistantTurnKind === "opening_read") {
    actions = withCustomAnswer(CONFIRM_OPENING_ACTIONS);
  } else if (state.assistantTurnKind === "character_board_summary") {
    actions = PLOT_GATE_ACTIONS;
  } else if (state.assistantTurnKind === "monetization_review") {
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
  if (focusId === "operator_pressure") return "relationship_function";
  if (focusId === "relationship_core") return "world_pressure";
  return "character_anchor";
}

function allowedNextMove(state: PlotLabPlannedStateInput): string {
  const currentFocusLabel = state.stage1FocusPlan.find((focus) => focus.focusId === state.focusId)?.label ?? FOCUS_LABELS[state.focusId];
  if (state.assistantTurnKind === "opening_read") {
    return "Give a 3-4 sentence EP1 grounding read, then ask if the reading is correct or if the writer wants to add context.";
  }
  if (state.assistantTurnKind === "checkpoint_summary") {
    return "Stop drilling this focus. Summarize the working lock in 2-3 sentences. The app will offer Move to next character / Ask different angle.";
  }
  if (state.assistantTurnKind === "add_more_check") {
    if (state.focusId === "plot" && (state.lastUserIntent === "add_missing_detail" || state.lastUserIntent === "stay_character")) {
      return "Ask only: Anything important we missed before monetization? The writer can add a character, relationship, world pressure, or plot thread.";
    }
    return `Ask only: Anything else about ${currentFocusLabel} you want to add?`;
  }
  if (state.assistantTurnKind === "transition_next_focus") {
    return `Move to ${currentFocusLabel} and ask the only open EP1-grounded discovery question for that focus.`;
  }
  if (state.assistantTurnKind === "character_board_summary") {
    return "Summarize the source-led character board and ask whether to move into the paywall question or add any missing character, relationship, world-pressure, or plot-thread detail.";
  }
  if (state.assistantTurnKind === "monetization_bridge") {
    return "Summarize EP1 big thread + character board + main relationship, then ask what the paywall question should be. No first plot beat yet.";
  }
  if (state.assistantTurnKind === "stage_1_complete") {
    return "Stop at Stage 1 completion. Confirm the character, relationship, and paywall locks are ready for a later Stage 2, but do not build beats yet.";
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
    return "Framework slot screen_promise: ask what viewers should count on from this source-led character on screen. Keep it craft-facing, concrete, and light; no therapy language.";
  }
  if (state.questionVector === "external_pressure") {
    return "Ask one easy source-grounded question about the visible obstacle or situation. Do not ask internal-psychology variants.";
  }
  if (state.questionVector === "relationship_function") {
    return "Framework slot relationship_conversion: ask what this person or obstacle changes in the protagonist's life after EP1.";
  }
  if (state.questionVector === "world_pressure") {
    return "Framework slot arena: ask what larger relationship or situation EP1 opens. Keep it broad, plain, and useful.";
  }
  return "Ask one open EP1-rooted discovery question. No plot mechanics yet.";
}

function waitingFor(state: PlotLabStateInput): string {
  if (state.questionMode === "requested_options") return "choose_option";
  if (state.questionMode === "fixed_actions") {
    if (state.assistantTurnKind === "opening_read") return "answer";
    if (state.assistantTurnKind === "character_board_summary") return "move_on";
    if (state.assistantTurnKind === "add_more_check") return "add_more";
    return "approve_lock";
  }
  if (state.assistantTurnKind === "discovery_question" || state.assistantTurnKind === "monetization_bridge") {
    return "answer";
  }
  if (state.assistantTurnKind === "checkpoint_summary" || state.assistantTurnKind === "monetization_review") {
    return "approve_lock";
  }
  if (state.assistantTurnKind === "character_board_summary") return "move_on";
  if (state.assistantTurnKind === "stage_1_complete") return "idle";
  if (state.assistantTurnKind === "plot_gate") return "runway_ready";
  return "idle";
}

function forbiddenMoves(
  state: PlotLabPlannedStateInput,
  plotDetailAllowed: boolean
): string[] {
  const currentFocusLabel = state.stage1FocusPlan.find((focus) => focus.focusId === state.focusId)?.label ?? FOCUS_LABELS[state.focusId];
  const base = [
    "Do not expose workflow labels.",
    "Do not ask more than one question.",
    "Do not invent UI buttons; the app renders them.",
    "Discovery questions should stay open and writer-led; structured options are answer starters, not narrow choice menus.",
  ];

  if (state.assistantTurnKind === "monetization_bridge") {
    return [
      ...base,
      "Do not ask for the first plot beat, scene tactics, counter-moves, texts/calls, deal terms, room logistics, runway, or Episode 2.",
      "Do ask for the paywall question after summarizing the EP1 thread, source-led character board, and main relationship.",
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

  if (state.assistantTurnKind === "add_more_check") {
    return [
      ...base,
      "Do not ask a deeper character, relationship, or paywall question.",
      `Do ask only whether there is anything else about ${currentFocusLabel} the writer wants to add.`,
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
    "Do not invent a third character; use only the source-led focus plan.",
    state.questionVector === "external_pressure" || state.questionVector === "world_pressure"
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
