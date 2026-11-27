import type { DocumentOrientation } from "@/lib/document-orientation";

export type PredefinedLabMode =
  | "predef_lab_beats"
  | "predef_lab_dialogue_design"
  | "predef_lab_draft"
  | "predef_lab_iterate"
  | "predef_lab_dialogue_pass";

export interface PredefinedLabContextEpisode {
  content: string;
}

export const DEFAULT_DIALOGUE_DESIGN_INSTRUCTION =
  "Build a source-bound dialogue plan from the finalized key beats and editable prompt source. Preserve the prompt facts and order; do not add new characters, questions, conflicts, or scene events.";

const PORTRAIT_PROMPT_BOX_INSTRUCTION =
  "Convert the selected plot into an approximately 1-1.5 minute playable microdrama episode. Preserve its causal events, character knowledge, relationships, order, and ending. Begin every scene already in motion. Use clear location geography, active character business, expressive blocking, setting-native props, stimulus-linked microexpressions, and emotionally responsive dialogue. Dialogue count is secondary to natural rhythm and complete emotional beats; the episode may extend slightly when a meaningful reaction or exchange needs room.";

const LANDSCAPE_PROMPT_BOX_INSTRUCTION =
  "Write this approximately 2-minute story milestone in the established landscape format. Follow the selected plot faithfully and move the chapter forward through cinematic action, spatially clear staging, environment, dialogue, and internal voice where useful. Escalate toward the chapter's eventual monetization cliffhanger without forcing this milestone to end on its own cliffhanger.";

export function buildPredefinedPromptBoxValue(
  selectedPlot: { content: string },
  orientation: DocumentOrientation
): string {
  const unitLabel = orientation === "landscape" ? "Target Milestone" : "Target Episode";
  const instruction =
    orientation === "landscape" ? LANDSCAPE_PROMPT_BOX_INSTRUCTION : PORTRAIT_PROMPT_BOX_INSTRUCTION;
  return `${unitLabel}:\n${selectedPlot.content.trim()}\n\nInstruction:\n${instruction}`;
}

export function buildEpisodeSourceContract({
  promptText,
  beatPlan,
}: {
  promptText: string;
  beatPlan: string;
}): string {
  return `Authority:
- This contract separates locked plot intent from permitted dramatization for Dialogue Design and Draft.
- The editable Prompt box is source truth. It contains the target episode outline plus any writer edits, emphasis, skips, or focus notes for this Lab run.
- Do not use the saved Microdrama Plot text as a hidden override. The selected dropdown episode is provenance only after the Prompt box is populated.

Locked Plot Intent:
- Preserve participants, relationships, causal events, revelations, character knowledge, explicit event or line order, writer emphasis or exclusions, and the ending outcome.
- Preserve names, role labels, and emotional targets. Do not name an unnamed character or turn confusion, concern, fear, care, or anger toward a different person.
- Preserve explicit modality and continuity: a silent gesture or nonverbal response stays nonverbal; established location, time of day, injuries, possessions, and entrances persist unless the source changes them.
- Preserve specificity boundaries: do not invent a name, number, currency, amount, date, deadline, appointment, address, message, or written label when the source leaves it vague.
- Approved Key Beats may compress or clarify the Prompt box but may not create a new causal event, conflict, revelation, ability, relationship, future obligation, or character.
- Dialogue Design and Draft must reject details that contradict or reorder the locked plot intent.

Permitted Dramatization:
- You may add active character business, setting-native props, entrances and exits, spatial positioning, eye lines, microexpressions, reaction beats, sensory details, and non-causal connective actions that make the locked plot playable.
- You may add or reshape natural dialogue turns inside an interaction already carried through speech. Do not convert an explicitly silent or action-only beat into dialogue.
- Added dialogue must change a tactic, relationship, decision, or required action; do not add generic self-talk or commentary that merely narrates visible behavior.
- A staging prop may externalize an existing fact, emotion, decision, or relationship. It may not introduce new evidence, powers, relationships, causal events, revelations, or future obligations.
- Text visible on a phone, calendar, note, sign, document, or screen must come from the source or selected continuity; a prop cannot smuggle in a new factual event.
- Every scene begins already in motion. No character waits neutrally for another character, line, or plot event. Physical stillness must be an active emotional or tactical response.

Editable Prompt:
${promptText.trim() || "(none)"}

Approved Key Beats:
${beatPlan.trim() || "(none yet)"}`;
}

export function buildPredefinedLabContext({
  mode,
  selectedPredefs,
  promptText,
  turnInstruction,
  beatPlan,
  dialogueDesign,
  draft,
}: {
  mode: PredefinedLabMode;
  selectedPredefs: PredefinedLabContextEpisode[];
  promptText: string;
  turnInstruction: string;
  beatPlan: string;
  dialogueDesign: string;
  draft: string;
}): string {
  const sourceContract = buildEpisodeSourceContract({ promptText, beatPlan });

  if (mode === "predef_lab_dialogue_design") {
    return `## Current Turn Instruction
${turnInstruction.trim() || "(none)"}

## Episode Source Contract
${sourceContract}

## Approved / Current Key Beats
${beatPlan.trim() || "(none yet)"}

## Selected Previous Predefined Episodes
${selectedPredefs.length > 0 ? selectedPredefs.map((section) => section.content).join("\n\n") : "(none selected)"}

## Approved / Current Dialogue Design
${dialogueDesign.trim() || "(none yet)"}

## Important Context Rule
The Characters tab is intentionally excluded. Use the Episode Source Contract as the hard factual boundary, and selected previous predefined episodes only for voice, continuity, relationship state, and knowledge state.`;
  }

  return `## Current Turn Instruction
${turnInstruction.trim() || "(none)"}

## Episode Source Contract
${sourceContract}

## Selected Previous Predefined Episodes
${selectedPredefs.length > 0 ? selectedPredefs.map((section) => section.content).join("\n\n") : "(none selected)"}

## Approved / Current Key Beats
${beatPlan.trim() || "(none yet)"}

## Approved / Current Dialogue Design
${dialogueDesign.trim() || "(none yet)"}

## Current Draft
${draft.trim() || "(none yet)"}

## Important Context Rule
The Characters tab is intentionally excluded. Use selected previous predefined episodes for voice, continuity, and knowledge state.`;
}
