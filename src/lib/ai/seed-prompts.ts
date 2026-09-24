// Boot-time reseed of system prompts.
//
// The /api/prompts route used to do this lazily on the first GET, gated by
// an in-process `seeded` flag. That meant edits to prompts.ts only took
// effect after an admin opened the Prompts panel — easy to forget, easy to
// ship a code change to prod that quietly used the previous DB content.
//
// Now instrumentation.ts calls this on boot. The /api/prompts route still
// upserts on first GET as a safety net, but the boot path is the contract:
// edit code, restart server, prompts reflect the change.
//
// Admin edits made through the Prompts UI within a single server session
// still survive until the next restart, since they overwrite the DB row
// after this seed runs.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import {
  EDIT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  FEEDBACK_SYSTEM_PROMPT,
  FORMAT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  DOCUMENT_STYLE_GUIDE,
  CANONICAL_REF_EPISODE_FORMAT,
  EPISODE_PLOTS_FORMAT,
  MICRODRAMA_SCRIPTWRITER_KNOWLEDGE,
  MICRODRAMA_ADAPTATION_KNOWLEDGE,
  MICRODRAMA_EPISODE_TOOLKIT,
  MICRODRAMA_STORY_ENGINE,
  MICRODRAMA_SERIES_ENGINE,
  MICRODRAMA_CHARACTER_ENGINE,
  MICRODRAMA_GENRE_CONTRACT,
  PLOT_INTEGRITY_AUDIT,
  BEAT_OPTION_FRAMEWORK,
  EPISODE_PLOT_ADAPTATION_WORKFLOW,
  PLOT_CHUNKS_SYSTEM_PROMPT,
  NEXT_EPISODE_PLOT_SYSTEM_PROMPT,
  NEXT_REFERENCE_EPISODE_SYSTEM_PROMPT,
  EARLY_REFERENCE_EPISODE_SYSTEM_PROMPT,
  CHARACTER_QUESTIONNAIRE_PREP_SYSTEM_PROMPT,
  PILOT_EPISODE_SYSTEM_PROMPT,
  SERIES_SKELETON_SYSTEM_PROMPT,
  QUALITY_AGENT_SYSTEM_PROMPT,
  RESEARCH_AGENT_SYSTEM_PROMPT,
  OUTSIDERS_PERSPECTIVE_SYSTEM_PROMPT,
  OUTSIDERS_PERSPECTIVE_BRIEF_SYSTEM_PROMPT,
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
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  NARRATIVE_SCAN_STATE_PROMPT,
  NARRATIVE_SCAN_AUDIT_PROMPT,
  PLOT_SCAN_ANALYZE_PROMPT,
  PLOT_SCAN_REVIEW_PROMPT,
} from "@/lib/ai/prompts";

const DEFAULTS = [
  { id: "style_guide", label: "Style Guide", content: DOCUMENT_STYLE_GUIDE },
  { id: "edit", label: "Select & Edit", content: EDIT_SYSTEM_PROMPT },
  { id: "draft", label: "Series Creation (Blank Doc)", content: DRAFT_SYSTEM_PROMPT },
  { id: "feedback", label: "Full-Doc Feedback", content: FEEDBACK_SYSTEM_PROMPT },
  { id: "format", label: "Format Document", content: FORMAT_SYSTEM_PROMPT },
  { id: "chat", label: "Chat Mode", content: CHAT_SYSTEM_PROMPT },
  { id: "ref_episode_format", label: "Reference Episode Format Spec", content: CANONICAL_REF_EPISODE_FORMAT },
  { id: "episode_plots_format", label: "Episode Plots Format Spec", content: EPISODE_PLOTS_FORMAT },
  { id: "scriptwriter_knowledge", label: "Microdrama Craft Knowledge", content: MICRODRAMA_SCRIPTWRITER_KNOWLEDGE },
  { id: "adaptation_knowledge", label: "Microdrama Adaptation Knowledge (Arc & Compression)", content: MICRODRAMA_ADAPTATION_KNOWLEDGE },
  { id: "episode_toolkit", label: "Microdrama Episode Toolkit", content: MICRODRAMA_EPISODE_TOOLKIT },
  { id: "story_engine", label: "Microdrama Story Engine", content: MICRODRAMA_STORY_ENGINE },
  { id: "series_engine", label: "Microdrama Series Engine", content: MICRODRAMA_SERIES_ENGINE },
  { id: "plot_integrity_audit", label: "Plot Integrity Audit", content: PLOT_INTEGRITY_AUDIT },
  { id: "beat_option_framework", label: "Beat Option Framework", content: BEAT_OPTION_FRAMEWORK },
  { id: "adaptation_workflow", label: "Episode Plot Adaptation Workflow", content: EPISODE_PLOT_ADAPTATION_WORKFLOW },
  { id: "character_engine", label: "Microdrama Character Engine", content: MICRODRAMA_CHARACTER_ENGINE },
  { id: "genre_contract", label: "Microdrama Genre Contract", content: MICRODRAMA_GENRE_CONTRACT },
  { id: "plot_chunks", label: "Workbook: Create Plot Chunks", content: PLOT_CHUNKS_SYSTEM_PROMPT },
  { id: "next_episode_plot", label: "Workbook: Create Next Episode Plot", content: NEXT_EPISODE_PLOT_SYSTEM_PROMPT },
  { id: "next_reference_episode", label: "Workbook: Create Next Reference Episode", content: NEXT_REFERENCE_EPISODE_SYSTEM_PROMPT },
  { id: "early_reference_episode", label: "Workbook: Create Early Reference Episode (Episodes 1-3)", content: EARLY_REFERENCE_EPISODE_SYSTEM_PROMPT },
  { id: "prepare_character_questionnaire", label: "Workbook: Prepare Character Cast", content: CHARACTER_QUESTIONNAIRE_PREP_SYSTEM_PROMPT },
  { id: "pilot_episode", label: "Workbook: Write Pilot Episode (3 options)", content: PILOT_EPISODE_SYSTEM_PROMPT },
  { id: "series_skeleton", label: "Workbook: Create Series Skeleton (45-ep arc)", content: SERIES_SKELETON_SYSTEM_PROMPT },
  { id: "quality_agent", label: "Quality Agent", content: QUALITY_AGENT_SYSTEM_PROMPT },
  { id: "research_agent", label: "Research Agent", content: RESEARCH_AGENT_SYSTEM_PROMPT },
  { id: "outsiders_perspective", label: "Outsiders Perspective Agent", content: OUTSIDERS_PERSPECTIVE_SYSTEM_PROMPT },
  { id: "outsiders_perspective_brief", label: "Outsiders Perspective Agent (Brief)", content: OUTSIDERS_PERSPECTIVE_BRIEF_SYSTEM_PROMPT },
  { id: "pipe_world_state", label: "Pipeline: Build World", content: WORLD_STATE_SYSTEM_PROMPT },
  { id: "pipe_beat_gen",    label: "Pipeline: Suggest Beats", content: BEAT_GEN_SYSTEM_PROMPT },
  { id: "pipe_causality",   label: "Pipeline: Connect the Story", content: CAUSALITY_SYSTEM_PROMPT },
  { id: "pipe_plot_synth",  label: "Pipeline: Write Plots", content: PLOT_SYNTH_SYSTEM_PROMPT },
  { id: "pipe_continuation_state", label: "Pipeline: Build Continuation State v1.0", content: CONTINUATION_STATE_SYSTEM_PROMPT },
  { id: "pipe_continuation_beats", label: "Pipeline: Suggest Continuation Beats v1.0", content: CONTINUATION_BEAT_SYSTEM_PROMPT },
  { id: "pipe_continuation_logic", label: "Pipeline: Connect Continuation Story v1.0", content: CONTINUATION_LOGIC_SYSTEM_PROMPT },
  { id: "pipe_continuation_synth", label: "Pipeline: Write Continuation Pack v1.0", content: CONTINUATION_SYNTH_SYSTEM_PROMPT },
  { id: "predef_lab_beats", label: "Predefined Lab: Build Key Beats", content: PREDEFINED_LAB_BEATS_PROMPT },
  { id: "predef_lab_draft", label: "Predefined Lab: Write Episode Draft", content: PREDEFINED_LAB_DRAFT_PROMPT },
  { id: "predef_lab_iterate", label: "Predefined Lab: Iterate Draft", content: PREDEFINED_LAB_ITERATE_PROMPT },
  { id: "predef_lab_dialogue_pass", label: "Predefined Lab: Dialogue Pass", content: PREDEFINED_LAB_DIALOGUE_PASS_PROMPT },
  { id: "entity_extraction", label: "Sync: Entity Extraction (Characters + Locations)", content: ENTITY_EXTRACTION_SYSTEM_PROMPT },
  { id: "narrative_scan_state", label: "Narrative Scanner: State Extraction (Pass 1)", content: NARRATIVE_SCAN_STATE_PROMPT },
  { id: "narrative_scan_audit", label: "Narrative Scanner: Journey Audit (Pass 2)", content: NARRATIVE_SCAN_AUDIT_PROMPT },
  { id: "plot_scan_analyze", label: "Plot Scanner: Structure Analysis (Pass 1)", content: PLOT_SCAN_ANALYZE_PROMPT },
  { id: "plot_scan_review", label: "Plot Scanner: Gap & Improvement Review (Pass 2)", content: PLOT_SCAN_REVIEW_PROMPT },
];

export async function seedPromptsFromCode(): Promise<number> {
  const now = new Date();
  let count = 0;
  for (const d of DEFAULTS) {
    const existing = await db.query.prompts.findFirst({
      where: eq(prompts.id, d.id),
    });
    if (existing) {
      await db
        .update(prompts)
        .set({ content: d.content, label: d.label, updatedAt: now })
        .where(eq(prompts.id, d.id));
    } else {
      await db.insert(prompts).values({ ...d, updatedAt: now });
    }
    count += 1;
  }
  return count;
}
