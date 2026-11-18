import type { DocumentOrientation } from "@/lib/document-orientation";

/**
 * Prompt title: Landscape Content Profile
 * Version: landscape-v1-2026-11-17
 * Changelog:
 * - 2026-11-17: Added milestone, chapter-runway, cinematic script, and evaluation contracts.
 */
export const CONTENT_PROFILE_CONTRACT_VERSION = "landscape-v1-2026-11-17";

export type PromptContractFamily =
  | "unit_semantics"
  | "plot_output"
  | "script_output"
  | "series_architecture"
  | "evaluation";

const LANDSCAPE_CONTRACTS: Record<PromptContractFamily, string> = {
  unit_semantics: `## Landscape unit semantics
- This landscape contract overrides any earlier portrait-only instruction that requires a 60-90 second episode, a fixed opening-beat count, or a cliffhanger at the end of every unit.
- Treat each compatibility-labelled "Episode N" as one story milestone of roughly 2 minutes, not a complete one-minute episode.
- Four or five sequential milestones may form an 8-10 minute chapter. Do not invent, store, or emit chapter metadata.
- Keep the existing [H3] Episode N headings because downstream tools depend on them; the heading is a compatibility label, not a pacing command.`,
  plot_output: `## Landscape plot contract
- The writer-selected plot is authoritative. Advance its specific causal turn as a meaningful milestone.
- A milestone should create forward motion and a useful checkpoint, but it does not need an artificial cliffhanger or complete mini-arc.
- In the existing Plot Lab workflow, interpret E2-E5 as milestones 2-5 in the current chapter runway, building toward its monetization endpoint.
- Within each 4-5 milestone runway, let tension and value accumulate toward a chapter-end monetization turn. Do not force every milestone to perform the chapter ending.`,
  script_output: `## Landscape script contract
- Write for a cinematic landscape frame. Use width, depth, blocking, stable geography, foreground/midground/background relationships, motivated movement, and an environment that carries story.
- Preserve the existing Seq / Visual / Dialogue / V.O. grammar and tagged output format.
- Do not obey portrait-only limits for dialogue-line count, opening-beat count, one-minute runtime, or mandatory end-of-unit cliffhangers.
- Do not add camera jargon or shot lists. Let staging and readable action communicate the frame.`,
  series_architecture: `## Landscape series architecture and monetization
- Build chapters from 4-5 causally linked milestones (about 8-10 minutes total).
- Escalate the monetization promise across the chapter runway and make the final milestone carry the strongest chapter-end turn when the supplied story plan supports it.
- Respect all written milestones and plots as ground truth. Never restart numbering or regenerate earlier milestones.`,
  evaluation: `## Landscape evaluation contract
- Judge causal progress, chapter-level escalation, spatial storytelling, continuity, and whether the milestone earns its place in the runway.
- Do not penalize the work for exceeding portrait dialogue caps, lacking a one-minute cliffhanger, or using a slower cinematic build.
- Still flag repetition, inert scenes, unclear geography, unmotivated action, continuity breaks, or a weak chapter-end payoff when evaluating the end of a runway.`,
};

const FAMILY_BY_PROMPT = new Map<string, PromptContractFamily[]>([
  ["chat", ["unit_semantics", "plot_output", "script_output", "series_architecture"]],
  ["draft", ["unit_semantics", "script_output", "series_architecture"]],
  ["edit", ["unit_semantics", "script_output"]],
  ["format", ["unit_semantics", "script_output"]],
  ["feedback", ["unit_semantics", "evaluation"]],
  ["pipe_world_state", ["unit_semantics", "series_architecture"]],
  ["pipe_beat_gen", ["unit_semantics", "plot_output", "series_architecture"]],
  ["pipe_causality", ["unit_semantics", "plot_output", "series_architecture"]],
  ["pipe_plot_synth", ["unit_semantics", "plot_output", "series_architecture"]],
  ["pipe_continuation_state", ["unit_semantics", "series_architecture"]],
  ["pipe_continuation_beats", ["unit_semantics", "plot_output", "series_architecture"]],
  ["pipe_continuation_logic", ["unit_semantics", "plot_output", "series_architecture"]],
  ["pipe_continuation_synth", ["unit_semantics", "plot_output", "series_architecture"]],
  ["predef_lab_beats", ["unit_semantics", "plot_output", "series_architecture"]],
  ["predef_lab_dialogue_design", ["unit_semantics", "script_output"]],
  ["predef_lab_draft", ["unit_semantics", "script_output", "series_architecture"]],
  ["predef_lab_iterate", ["unit_semantics", "script_output"]],
  ["predef_lab_dialogue_pass", ["unit_semantics", "script_output"]],
  ["plot_lab_chat", ["unit_semantics", "plot_output", "series_architecture"]],
  ["plot_lab_source_soul_scan", ["unit_semantics", "series_architecture"]],
  ["plot_lab_character_analyst", ["unit_semantics"]],
  ["plot_lab_continuity_audit", ["unit_semantics", "evaluation"]],
  ["plot_lab_paywall_architect", ["unit_semantics", "series_architecture"]],
  ["plot_lab_premise_bridge", ["unit_semantics", "plot_output", "series_architecture"]],
  ["plot_lab_universe_builder", ["unit_semantics", "series_architecture"]],
  ["plot_lab_runway_sketch", ["unit_semantics", "plot_output", "series_architecture"]],
  ["plot_lab_save_preview", ["unit_semantics", "plot_output"]],
  ["plot_lab_final_plot", ["unit_semantics", "plot_output", "series_architecture"]],
  ["plot_chunks", ["unit_semantics", "plot_output", "series_architecture"]],
  ["next_episode_plot", ["unit_semantics", "plot_output", "series_architecture"]],
  ["next_reference_episode", ["unit_semantics", "script_output", "series_architecture"]],
  ["pilot_episode", ["unit_semantics", "script_output", "series_architecture"]],
  ["format_tab", ["unit_semantics", "script_output"]],
  ["series_skeleton", ["unit_semantics", "series_architecture"]],
  ["series_skeleton_predefined", ["unit_semantics", "series_architecture"]],
  ["series_skeleton_auto", ["unit_semantics", "series_architecture"]],
]);

export function composePromptForOrientation(
  basePrompt: string,
  promptId: string,
  orientation: DocumentOrientation
): string {
  if (orientation === "portrait") return basePrompt;
  const families = FAMILY_BY_PROMPT.get(promptId) ?? ["unit_semantics", "script_output"];
  return `${basePrompt}\n\n# DOCUMENT CONTENT PROFILE (highest-priority format contract)\nProfile: landscape\nContract version: ${CONTENT_PROFILE_CONTRACT_VERSION}\nThe rules below override conflicting portrait or microdrama pacing rules earlier in this prompt. Preserve all non-conflicting story, canon, safety, and output-format requirements.\n\n${families
    .map((family) => LANDSCAPE_CONTRACTS[family])
    .join("\n\n")}`;
}
