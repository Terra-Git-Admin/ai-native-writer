export type PlotLabStage =
  | "evidence_read"
  | "soul_bible"
  | "core_contract"
  | "character_truth"
  | "visual_paywall"
  | "paywall_endpoint"
  | "episode_runway"
  | "episode_2_design"
  | "episode_sketches"
  | "final_plot_expansion";

// Keep this internal state aligned with docs/plot-lab-levi-cockpit-spec.md.
// The state machine guides Levi and save routing; it is not a visible cockpit rail.
export type PlotLabStageStatus =
  | "needs_read"
  | "needs_question"
  | "options_open"
  | "summary_ready"
  | "save_pending"
  | "locked"
  | "revise_needed";

export type PlotLabAllowedAction =
  | "ask"
  | "choose_option"
  | "custom_merge"
  | "reroll"
  | "confirm_summary"
  | "save"
  | "revise"
  | "generate_sketches"
  | "expand_final_plot";

export type PlotLabDecisionSection =
  | "Series Soul Bible"
  | "Character Soul Cards"
  | "Core Contract"
  | "Character Pressure"
  | "Visual Paywall"
  | "Paywall Endpoint"
  | "Episode Runway"
  | "Episode 2 Design"
  | "Sketch Handoff"
  | "Soul Changelog";

export interface PlotLabWorkflowState {
  stage: PlotLabStage;
  status: PlotLabStageStatus;
  label: string;
  next: string;
  lockedCount: number;
  allowedActions: PlotLabAllowedAction[];
  qualityGate: string;
  destinationSection: PlotLabDecisionSection;
  completedStages: PlotLabStage[];
}

export interface PlotLabTaggedInputs {
  decisions: string;
  episodeSketches: string;
  finalPlots: string;
}

export interface PlotLabStageDefinition {
  stage: PlotLabStage;
  label: string;
  next: string;
  destinationSection: PlotLabDecisionSection;
  qualityGate: string;
  lockPatterns: RegExp[];
  allowedActions: PlotLabAllowedAction[];
}

export const PLOT_LAB_DECISION_SECTIONS: PlotLabDecisionSection[] = [
  "Series Soul Bible",
  "Character Soul Cards",
  "Core Contract",
  "Character Pressure",
  "Visual Paywall",
  "Paywall Endpoint",
  "Episode Runway",
  "Episode 2 Design",
  "Sketch Handoff",
  "Soul Changelog",
];

export const PLOT_LAB_STAGE_DEFINITIONS: PlotLabStageDefinition[] = [
  {
    stage: "evidence_read",
    label: "Evidence Read",
    next: "Read saved evidence and propose one small character-first lock",
    destinationSection: "Series Soul Bible",
    qualityGate: "Levi has understood what is actually on the page but only shows the writer one concise character-first next lock.",
    lockPatterns: [/evidence read|source scan|starting evidence|plot 1|predef/i],
    allowedActions: ["ask", "revise"],
  },
  {
    stage: "character_truth",
    label: "Character Truth",
    next: "Clarify one character function, immediate want, or power-language rule",
    destinationSection: "Character Pressure",
    qualityGate: "The next actions preserve the character's registered behavior, speech, power mechanics, and visible EP1 function before plot pressure is tuned.",
    lockPatterns: [/character pressure|character truth|protagonist pressure|opposing pressure|relationship pressure|immediate motivation|power language/i],
    allowedActions: ["ask", "choose_option", "custom_merge", "reroll", "confirm_summary"],
  },
  {
    stage: "core_contract",
    label: "Core Contract",
    next: "Lock the core dramatic promise",
    destinationSection: "Core Contract",
    qualityGate: "The central promise can generate repeated episodes without betraying the source.",
    lockPatterns: [/core contract|series hook|source promise|core thread/i],
    allowedActions: ["ask", "choose_option", "custom_merge", "reroll", "confirm_summary"],
  },
  {
    stage: "soul_bible",
    label: "Soul Bible",
    next: "Preserve series and character soul after character truth is clear",
    destinationSection: "Series Soul Bible",
    qualityGate: "Series appeal pattern, character soul, no-go contradictions, and current arc state are explicit without replacing character-first discovery.",
    lockPatterns: [/series soul bible|character soul cards|appeal pattern|soul changelog|no-go contradiction/i],
    allowedActions: ["ask", "choose_option", "custom_merge", "reroll", "confirm_summary"],
  },
  {
    stage: "visual_paywall",
    label: "Visual Paywall",
    next: "Find the paid visual question",
    destinationSection: "Visual Paywall",
    qualityGate: "The first-pack paywall can be understood as a concrete freeze-frame, not a vague premise.",
    lockPatterns: [/visual paywall|freeze-frame|freeze frame|paid visual|leverage object|visible power shift/i],
    allowedActions: ["ask", "choose_option", "custom_merge", "reroll", "confirm_summary"],
  },
  {
    stage: "paywall_endpoint",
    label: "Paywall Endpoint",
    next: "Lock the first-pack paid answer",
    destinationSection: "Paywall Endpoint",
    qualityGate: "The endpoint names who is under threat, what answer is withheld, and why viewers pay now.",
    lockPatterns: [/paywall endpoint|monetization endpoint|first-pack endpoint|first pack endpoint|cliffhanger endpoint|paid answer/i],
    allowedActions: ["ask", "choose_option", "custom_merge", "reroll", "confirm_summary"],
  },
  {
    stage: "episode_runway",
    label: "Episode Runway",
    next: "Make the path to the endpoint causal",
    destinationSection: "Episode Runway",
    qualityGate: "Episodes cannot simply skip to the endpoint; the pressure path is causal and playable.",
    lockPatterns: [/episode runway|e2 runway|immediate runway|runway decision|money acceptance|coerced|coercion/i],
    allowedActions: ["ask", "choose_option", "custom_merge", "reroll", "confirm_summary"],
  },
  {
    stage: "episode_2_design",
    label: "Episode 2 Design",
    next: "Make Episode 2 executable",
    destinationSection: "Episode 2 Design",
    qualityGate: "Episode 2 has one visible turn, one pressure shift, and one ending hook.",
    lockPatterns: [/episode 2 design|episode two design|e2 design|episode 2 option|episode 2 executable/i],
    allowedActions: ["ask", "choose_option", "custom_merge", "reroll", "confirm_summary"],
  },
  {
    stage: "episode_sketches",
    label: "Episode Sketches",
    next: "Sketch E2 through the paywall endpoint",
    destinationSection: "Sketch Handoff",
    qualityGate: "Each sketch is 1-2 sentences with driver, visible turn, and ending pressure.",
    lockPatterns: [/sketch handoff|episode sketches|sketch runway|e2-e5|e2 through/i],
    allowedActions: ["generate_sketches", "confirm_summary", "save", "revise"],
  },
  {
    stage: "final_plot_expansion",
    label: "Final Plot Expansion",
    next: "Expand one locked sketch into Microdrama Plots",
    destinationSection: "Sketch Handoff",
    qualityGate: "A selected sketch is locked before final expansion starts.",
    lockPatterns: [/final plot handoff|final plot expansion|microdrama plot expansion/i],
    allowedActions: ["expand_final_plot", "revise"],
  },
];

function hasMeaningfulTaggedContent(value: string, ignoredTitles: string[]): boolean {
  const ignored = new Set(ignoredTitles.map((title) => title.toLowerCase()));
  return value
    .split("\n")
    .some((line) => {
      const clean = line.replace(/^\[(?:H\d|P|UL|OL|HR)]\s*/, "").trim();
      return clean.length > 0 && !ignored.has(clean.toLowerCase());
    });
}

function decisionHasLock(decisions: string, definition: PlotLabStageDefinition): boolean {
  const lower = decisions.toLowerCase();
  const sectionLocked = PLOT_LAB_DECISION_SECTIONS.some((section) => {
    if (section !== definition.destinationSection) return false;
    return new RegExp(`^\\[H[23]\\]\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im").test(decisions);
  });
  return sectionLocked || definition.lockPatterns.some((pattern) => pattern.test(lower));
}

export function inferPlotLabWorkflowStateFromTagged(inputs: PlotLabTaggedInputs): PlotLabWorkflowState {
  const decisions = inputs.decisions ?? "";
  const completedStages: PlotLabStage[] = [];
  const lockedCount = (decisions.match(/^\[H[123]]\s+/gm) ?? []).filter((heading) => !/plot lab decisions/i.test(heading)).length;
  const hasSketches = hasMeaningfulTaggedContent(inputs.episodeSketches, ["Episode Sketches"]);
  const hasFinalPlots = hasMeaningfulTaggedContent(inputs.finalPlots, ["Microdrama Plots"]);

  for (const definition of PLOT_LAB_STAGE_DEFINITIONS) {
    if (definition.stage === "episode_sketches") {
      if (hasSketches) completedStages.push(definition.stage);
      continue;
    }
    if (definition.stage === "final_plot_expansion") {
      if (hasFinalPlots) completedStages.push(definition.stage);
      continue;
    }
    if (decisionHasLock(decisions, definition)) completedStages.push(definition.stage);
  }

  const activeDefinition =
    PLOT_LAB_STAGE_DEFINITIONS.find((definition) => !completedStages.includes(definition.stage)) ??
    PLOT_LAB_STAGE_DEFINITIONS[PLOT_LAB_STAGE_DEFINITIONS.length - 1];

  return {
    stage: activeDefinition.stage,
    status: activeDefinition.stage === "evidence_read" ? "needs_read" : "needs_question",
    label: activeDefinition.label,
    next: activeDefinition.next,
    lockedCount,
    allowedActions: activeDefinition.allowedActions,
    qualityGate: activeDefinition.qualityGate,
    destinationSection: activeDefinition.destinationSection,
    completedStages,
  };
}

export function renderPlotLabWorkflowContext(state: PlotLabWorkflowState): string {
  return [
    "## Plot Lab Workflow State",
    `- Current stage: ${state.label} (${state.stage})`,
    `- Status: ${state.status}`,
    `- Next move: ${state.next}`,
    `- Quality gate: ${state.qualityGate}`,
    `- Destination section for a lock: ${state.destinationSection}`,
    `- Completed stages: ${state.completedStages.length ? state.completedStages.join(", ") : "none"}`,
    `- Allowed actions now: ${state.allowedActions.join(", ")}`,
  ].join("\n");
}

export function inferPlotLabDecisionSection(text: string): PlotLabDecisionSection {
  const lower = text.toLowerCase();
  if (/soul changelog|changed from|evolved from|soul changed/.test(lower)) return "Soul Changelog";
  if (/character soul|voice|power language|speaks|silence|gesture|raised eyebrow|finger|behavior/.test(lower)) return "Character Soul Cards";
  if (/series soul|appeal pattern|no-go contradiction|meet cute|almost meet|almost-meet|bible/.test(lower)) return "Series Soul Bible";
  if (/visual paywall|freeze-frame|freeze frame|paid visual|leverage object|visible power shift/.test(lower)) return "Visual Paywall";
  if (/paywall endpoint|monetization endpoint|paid answer|first-pack|first pack|cliffhanger endpoint/.test(lower)) return "Paywall Endpoint";
  if (/episode 2 design|e2 design|episode two design/.test(lower)) return "Episode 2 Design";
  if (/episode runway|e2 runway|immediate runway|runway|money acceptance|coerced|coercion/.test(lower)) return "Episode Runway";
  if (/character pressure|character truth|protagonist pressure|opposing pressure|relationship pressure|immediate motivation/.test(lower)) return "Character Pressure";
  if (/sketch handoff|episode sketches|e2-e5|e2 through/.test(lower)) return "Sketch Handoff";
  return "Core Contract";
}
