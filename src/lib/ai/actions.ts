// Action registry for the cross-tab persistent AI assistant.
//
// Each promptKind that ai_jobs supports has one Action implementation here.
// runJob() in jobs.ts looks up the action by kind, calls loadContext to
// build the user message, and getSystemPrompt to pull the system instruction.
//
// Adding a fourth action (e.g. brainstorm_dialogues v2) is one new file's
// worth of work: register a new entry in the ACTIONS map.
//
// Per-kind context loaders live close to the prompts they feed so the
// branching logic (bootstrap / standard / extend modes for plot_chunks)
// stays in code rather than leaking into the system prompt.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tabs, prompts as promptsTable } from "@/lib/db/schema";
import {
  tiptapJsonToTagged,
  splitTabByH3,
  type H3Section,
} from "@/lib/ai/context-engine";
import {
  PLOT_CHUNKS_SYSTEM_PROMPT,
  NEXT_EPISODE_PLOT_SYSTEM_PROMPT,
  NEXT_REFERENCE_EPISODE_SYSTEM_PROMPT,
  FORMAT_SYSTEM_PROMPT,
  SERIES_SKELETON_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import type { PromptKind } from "@/lib/ai/jobs";

export interface ActionInput {
  documentId: string;
  tabId: string | null;
}

export interface Action {
  kind: PromptKind;
  // Overridable in DB via the prompts table (id matches kind). Falls back
  // to the system-prompt constant from prompts.ts.
  systemPromptId: string;
  systemPromptFallback: string;
  loadContext(input: ActionInput): Promise<string>;
}

// ─── Helpers ───

interface DocumentTabs {
  seriesOverview?: { id: string; type: string; content: string | null; title: string };
  characters?: { id: string; type: string; content: string | null; title: string };
  seriesSkeleton?: { id: string; type: string; content: string | null; title: string };
  microdramaPlots?: { id: string; type: string; content: string | null; title: string };
  predefinedEpisodes?: { id: string; type: string; content: string | null; title: string };
  workbook?: { id: string; type: string; content: string | null; title: string };
}

async function loadDocumentTabs(documentId: string): Promise<DocumentTabs> {
  const rows = await db.query.tabs.findMany({
    where: eq(tabs.documentId, documentId),
  });
  const out: DocumentTabs = {};
  for (const r of rows) {
    const slim = { id: r.id, type: r.type, content: r.content, title: r.title };
    if (r.type === "series_overview") out.seriesOverview = slim;
    else if (r.type === "characters") out.characters = slim;
    else if (r.type === "series_skeleton") out.seriesSkeleton = slim;
    else if (r.type === "microdrama_plots") out.microdramaPlots = slim;
    else if (r.type === "predefined_episodes") out.predefinedEpisodes = slim;
    else if (r.type === "workbook") out.workbook = slim;
  }
  return out;
}

// Test whether a tab's tagged content actually contains a usable Series
// Skeleton — not just an empty [H1] placeholder. The Microdrama Plot agent
// refuses if this returns false.
function hasUsableSkeleton(taggedContent: string): boolean {
  const stripped = taggedContent.replace(/\s/g, "");
  if (stripped.length < 200) return false;
  // Real skeletons have at least one phase-breakdown [H3] and a Cast section
  const hasPhase = /\[H3\]\s*Phase\s+\d/i.test(taggedContent);
  const hasCast = /\[H2\]\s*Cast/i.test(taggedContent);
  return hasPhase || hasCast;
}

// Plot Chunks input: last 10 microdrama plots + episode 1 for premise anchor
// when episode count is 11+. For 3–10, all plots fit. For <3, this branch
// isn't entered — bootstrap mode loads research + logline instead.
function selectPlotInput(plots: H3Section[]): H3Section[] {
  if (plots.length === 0) return [];
  if (plots.length <= 10) return plots;
  const last10 = plots.slice(plots.length - 10);
  // Episode 1 is the first plot. Already in last10? Only if plots.length === 10
  // (handled above). Otherwise include it explicitly.
  return [plots[0], ...last10];
}

// Best-effort logline extraction from the series_overview tagged content.
// Mirrors context-engine's extractLogline (kept inline to avoid pulling
// the full client-side context engine).
function extractLogline(seriesOverviewTagged: string): string {
  const lines = seriesOverviewTagged.split("\n");
  for (const line of lines) {
    const m = line.match(/^\[P\]\s*Logline:\s*(.+)/i);
    if (m) return m[1].trim();
  }
  // Fallback: first [P] after [H1].
  let sawH1 = false;
  for (const line of lines) {
    if (/^\[H1\]/.test(line)) { sawH1 = true; continue; }
    if (sawH1 && /^\[P\]/.test(line)) {
      return line.replace(/^\[P\]\s*/, "").trim();
    }
  }
  return "";
}

// ─── plot_chunks ───

async function loadPlotChunksContext(input: ActionInput): Promise<string> {
  const { documentId } = input;
  const docTabs = await loadDocumentTabs(documentId);

  const plotsTagged = tiptapJsonToTagged(
    docTabs.microdramaPlots?.content ?? null
  );
  const plotSections = splitTabByH3(plotsTagged);
  const episodeCount = plotSections.length;

  const charactersTagged = tiptapJsonToTagged(
    docTabs.characters?.content ?? null
  );

  if (episodeCount < 3) {
    // bootstrap
    const seriesOverviewTagged = tiptapJsonToTagged(
      docTabs.seriesOverview?.content ?? null
    );
    const logline = extractLogline(seriesOverviewTagged);

    return `MODE: bootstrap
Episodes plotted so far: ${episodeCount}

## Logline
${logline || "(missing — fall back to inferring from research)"}

## Original Research
${seriesOverviewTagged || "(empty)"}

## Characters
${charactersTagged || "(empty)"}

${
  episodeCount > 0
    ? `## Existing microdrama plots (${episodeCount} so far — too few to drive chunks; use as orientation only)\n${plotSections.map((s) => s.content).join("\n\n")}`
    : "## Existing microdrama plots\n(none yet)"
}

Task: Generate plot chunks from the research and logline. Episodes 1–10 are setup; chunks here lay the foundation. Apply microdrama rules.`;
  }

  if (episodeCount > 10) {
    // extend
    const plotInput = selectPlotInput(plotSections);
    const workbookTagged = tiptapJsonToTagged(
      docTabs.workbook?.content ?? null
    );

    return `MODE: extend
Total microdrama plots in show: ${episodeCount}

## Recent microdrama plots (last 10 + episode 1 for premise anchor)
${plotInput.map((s) => s.content).join("\n\n")}

## Characters
${charactersTagged || "(empty)"}

## Existing chunks / workbook content (build on these — do not create new chunks)
${workbookTagged || "(empty workbook — flag this; user may have wiped it)"}

Task: Take the existing chunks above and continue them. Show how each existing chunk progresses across the next 5 episodes. New plot chunks are not required at this point in the show; build on what is already in motion.`;
  }

  // standard (3 ≤ count ≤ 10)
  const plotInput = selectPlotInput(plotSections);
  return `MODE: standard
Total microdrama plots in show: ${episodeCount} (all included)

## Microdrama plots (full chain)
${plotInput.map((s) => s.content).join("\n\n")}

## Characters
${charactersTagged || "(empty)"}

Task: Generate plot chunks that propose how key story beats can play out across the next 5 episodes. Read the existing plots for pacing rhythm. Episodes 1–10 are setup; chunks here build the foundation for what's coming. Apply microdrama rules.`;
}

// ─── next_episode_plot ───
//
// One-episode-at-a-time microdrama plot agent. Reads the canonical Series
// Skeleton tab (refuses if not present) + ALL existing microdrama plots
// (no truncation — full chain) + characters + last reference episode (for
// cliffhanger pickup). Outputs ONE [H3] for the next episode.

async function loadNextEpisodePlotContext(input: ActionInput): Promise<string> {
  const { documentId } = input;
  const docTabs = await loadDocumentTabs(documentId);

  const skeletonTagged = tiptapJsonToTagged(
    docTabs.seriesSkeleton?.content ?? null
  );
  if (!hasUsableSkeleton(skeletonTagged)) {
    throw new Error(
      "Series Skeleton tab is empty or incomplete. Run the Create Series Skeleton agent first, finalise the output in the Workbook, then paste the polished version into the Series Skeleton tab — the Microdrama Plot agent reads from that tab as the authoritative spine."
    );
  }

  const plotsTagged = tiptapJsonToTagged(
    docTabs.microdramaPlots?.content ?? null
  );
  const plotSections = splitTabByH3(plotsTagged);
  const charactersTagged = tiptapJsonToTagged(
    docTabs.characters?.content ?? null
  );

  // For cliffhanger pickup: read the last reference episode if any exists.
  // The new episode plot's hook should imply the previous episode's
  // cliffhanger since they're back-to-back in the writer's mind.
  const refTagged = tiptapJsonToTagged(
    docTabs.predefinedEpisodes?.content ?? null
  );
  const refSections = splitTabByH3(refTagged);
  const lastRefEp = refSections[refSections.length - 1];

  const nextEpisodeNumber = plotSections.length + 1;
  const phaseNumber = Math.min(9, Math.ceil(nextEpisodeNumber / 5));

  return `## Series Skeleton (AUTHORITATIVE — the spine, character arcs, and phase breakdown for this 45-episode show)
${skeletonTagged}

## All Existing Microdrama Plots (full chain — every episode plotted so far, no truncation)
${
  plotSections.length > 0
    ? plotSections.map((s) => s.content).join("\n\n")
    : "(no plots exist yet — this will be Episode 1; build from the skeleton's Phase 1 plan)"
}

## Characters (canonical)
${charactersTagged || "(empty)"}

## Last Reference Episode (for cliffhanger pickup — your hook implies the cliffhanger here)
${lastRefEp ? lastRefEp.content : "(none yet — your hook can open cold without picking up from a prior cliffhanger)"}

Task: Propose ONE microdrama plot for Episode ${nextEpisodeNumber}. This episode falls in Phase ${phaseNumber} of the skeleton — read that phase's setup-payoff plan and information-state notes carefully. Output exactly ONE [H3] Episode ${nextEpisodeNumber} block in the per-spec microdrama plot format. No alternatives, no commentary, no preamble.`;
}

// ─── next_reference_episode ───
//
// Always expands the LAST microdrama plot in the tab into a full reference
// episode. Other episodes (re-generation, mid-series patching) are handled
// via chat per the writer's direction — this agent is single-purpose.

async function loadNextReferenceEpisodeContext(
  input: ActionInput
): Promise<string> {
  const { documentId } = input;
  const docTabs = await loadDocumentTabs(documentId);

  const plotsTagged = tiptapJsonToTagged(
    docTabs.microdramaPlots?.content ?? null
  );
  const plotSections = splitTabByH3(plotsTagged);

  if (plotSections.length === 0) {
    throw new Error(
      "No microdrama plots exist yet. Create the next episode plot first — this agent expands the LATEST microdrama plot into a full reference episode."
    );
  }

  const lastPlot = plotSections[plotSections.length - 1];
  const targetEpisodeNumber =
    lastPlot.title.match(/episode\s+(\d+)/i)?.[1] ?? `${plotSections.length}`;

  // Input-quality guard: refuse if the latest plot body is too thin to
  // expand reliably. Catches the "single letter plot triggers full-scene
  // hallucination" failure mode noted in the cross-tab assistant backlog.
  const plotBody = lastPlot.content.replace(/\s/g, "");
  if (plotBody.length < 60) {
    throw new Error(
      `Latest microdrama plot (Episode ${targetEpisodeNumber}) is too thin (${plotBody.length} chars after whitespace strip). Fill in the plot body before generating a reference episode — otherwise the agent will hallucinate scenes that aren't in your plan.`
    );
  }

  const refTagged = tiptapJsonToTagged(
    docTabs.predefinedEpisodes?.content ?? null
  );
  const refSections = splitTabByH3(refTagged);

  const charactersTagged = tiptapJsonToTagged(
    docTabs.characters?.content ?? null
  );

  return `## Latest Microdrama Plot (the one and only plot to expand — last [H3] in Microdrama Plots tab)
${lastPlot.content}

## Previous Reference Episodes (full chain — your voice + continuity reference, your first beat picks up from the LAST beat of the most recent reference episode below)
${
  refSections.length > 0
    ? refSections.map((s) => s.content).join("\n\n")
    : "(none yet — this is the first reference episode; open with the scene the plot opens on)"
}

## Characters (canonical voice profiles — use these to write distinct dialogue)
${charactersTagged || "(empty)"}

Task: Expand the Latest Microdrama Plot above into ONE full reference episode for Episode ${targetEpisodeNumber} in the canonical Visual / Dialogue / V.O. beat format. Output exactly one [H3] Episode ${targetEpisodeNumber} block. No preamble, no commentary, no alternatives. The reference episode realises the plot — every beat in the plot must surface in the episode.`;
}

// ─── format_tab ───
//
// Restructures a single tab's content into its canonical format. Reads the
// tab fresh from the DB at job-run time — the client must flush its pending
// editor save before starting this job, otherwise the LLM sees pre-debounce
// content. Origin tab travels through ai_jobs.tabId, so the apply step
// writes back to the same tab the writer started this job on, even if the
// writer has switched tabs while the job ran.
async function loadFormatTabContext(input: ActionInput): Promise<string> {
  const { documentId, tabId } = input;
  if (!tabId) {
    throw new Error("format_tab requires a tabId — origin tab is mandatory.");
  }
  const tab = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, tabId), eq(tabs.documentId, documentId)),
  });
  if (!tab) {
    throw new Error(`Tab ${tabId} not found in document ${documentId}.`);
  }
  const tagged = tiptapJsonToTagged(tab.content);
  return `## Active Tab — ${tab.title} (${tab.type})\n${tagged || "(empty)"}\n\nRestructure this tab's content according to the style guide. Output the full tab body with structural tags. Do not invent new content; promote mis-tagged blocks, split running text into proper blocks, and fix heading levels.`;
}

// ─── series_skeleton ───
//
// Strategic foundation agent. Reads ALL of Original Research + Characters +
// whatever is in Microdrama Plots so far + whatever is in Predefined
// Episodes so far. Existing plots are authoritative spine input — the
// agent reverse-engineers the skeleton from them and projects forward
// using research. Always 9 phases × 5 episodes = 45 total. The output is
// a 6-section workbook deliverable.

async function loadSeriesSkeletonContext(input: ActionInput): Promise<string> {
  const { documentId } = input;
  const docTabs = await loadDocumentTabs(documentId);

  const researchTagged = tiptapJsonToTagged(
    docTabs.seriesOverview?.content ?? null
  );
  const charactersTagged = tiptapJsonToTagged(
    docTabs.characters?.content ?? null
  );
  const plotsTagged = tiptapJsonToTagged(
    docTabs.microdramaPlots?.content ?? null
  );
  const refEpsTagged = tiptapJsonToTagged(
    docTabs.predefinedEpisodes?.content ?? null
  );

  // Input-quality guard: the agent needs at least source material OR
  // existing plots to anchor the skeleton on. Refuse if both are empty —
  // a skeleton from nothing is hallucination.
  const researchLen = researchTagged.replace(/\s/g, "").length;
  const plotsCount = (plotsTagged.match(/^\[H3\]/gm) ?? []).length;
  if (researchLen < 800 && plotsCount === 0) {
    throw new Error(
      "Series Skeleton needs source material to work from. Add content to the Original Research tab (at least 800 characters) or draft a few episode plots in Microdrama Plots first."
    );
  }

  const plotsBlock =
    plotsCount > 0
      ? `## Existing Microdrama Plots (AUTHORITATIVE — ${plotsCount} plots already drafted; treat as locked spine input for the phases they cover)\n${plotsTagged}`
      : `## Existing Microdrama Plots\n(none yet — generate skeleton fresh from research)`;

  const refEpsBlock = refEpsTagged.trim()
    ? `## Existing Reference Episodes (read-only context — useful for character voice and confirmed beats)\n${refEpsTagged}`
    : `## Existing Reference Episodes\n(none yet)`;

  return `## Original Research (source material)
${researchTagged || "(empty — rely on existing plots)"}

## Characters (existing)
${charactersTagged || "(empty)"}

${plotsBlock}

${refEpsBlock}

Task: Produce the 6-section Series Skeleton (Series Summary, Cast, Plotline Architecture, 9-phase Phase Breakdown, Character Arc Evolution, Structural Audit) per the system-prompt format. Always 45 episodes across 9 phases of 5 episodes each. Honor existing plots as authoritative for the phases they cover; project the rest forward from research.`;
}

// ─── Registry ───

const ACTIONS: Record<PromptKind, Action> = {
  plot_chunks: {
    kind: "plot_chunks",
    systemPromptId: "plot_chunks",
    systemPromptFallback: PLOT_CHUNKS_SYSTEM_PROMPT,
    loadContext: loadPlotChunksContext,
  },
  next_episode_plot: {
    kind: "next_episode_plot",
    systemPromptId: "next_episode_plot",
    systemPromptFallback: NEXT_EPISODE_PLOT_SYSTEM_PROMPT,
    loadContext: loadNextEpisodePlotContext,
  },
  next_reference_episode: {
    kind: "next_reference_episode",
    systemPromptId: "next_reference_episode",
    systemPromptFallback: NEXT_REFERENCE_EPISODE_SYSTEM_PROMPT,
    loadContext: loadNextReferenceEpisodeContext,
  },
  format_tab: {
    kind: "format_tab",
    // Reuse the existing 'format' system prompt — same restructure-this-tab
    // behaviour, now triggered through the durable jobs pipeline.
    systemPromptId: "format",
    systemPromptFallback: FORMAT_SYSTEM_PROMPT,
    loadContext: loadFormatTabContext,
  },
  series_skeleton: {
    kind: "series_skeleton",
    systemPromptId: "series_skeleton",
    systemPromptFallback: SERIES_SKELETON_SYSTEM_PROMPT,
    loadContext: loadSeriesSkeletonContext,
  },
};

export function getAction(kind: PromptKind): Action {
  const action = ACTIONS[kind];
  if (!action) {
    throw new Error(`No action registered for kind: ${kind}`);
  }
  return action;
}

// Resolve the system prompt for an action: tries the prompts table first
// (admin-editable), falls back to the constant.
export async function resolveSystemPrompt(action: Action): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(promptsTable.id, action.systemPromptId),
  });
  return row?.content || action.systemPromptFallback;
}
