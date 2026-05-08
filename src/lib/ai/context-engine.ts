// Client-side context engine for AI prompts.
//
// Given the open document's tabs and the active tab, produces a labeled
// context preamble tuned to the active tab's type.
//
// Baseline (always, if present in the doc):
//   - Original Plotline (Research tab content)
//   - Logline (from Series Overview)
//   - Characters (full)
//
// For predefined_episodes tabs (where the writer generates predefined episodes):
//   - The FULL chain of previous reference episodes in that tab — no limit.
//     Writers confirmed they want the entire history passed so continuity is
//     perfect; context budget is not a concern at current series lengths.
//   - The LAST microdrama plot in the Microdrama Plots tab, because the writer
//     finalises the next plot there as the last [H3] and then generates the
//     reference episode from it. That is the single plot that matters.
//
// For microdrama_plots tabs (plot editing, not ref-ep generation):
//   - Previous 3 + upcoming 3 [H3] plots in the tab for local continuity.
//   - Last 3 reference episodes paired by episode number for realised tone.
//
// For workbook tabs (writer's free-form scratch space):
//   - The FULL chain of previous reference episodes from the Predefined
//     Episodes tab. Writers draft new reference episodes in the workbook
//     and need every prior one for voice and continuity.
//   - The FULL chain of episode plots from the Microdrama Plots tab.
//   - The LAST episode plot called out explicitly as the "current" one —
//     i.e. the plot the next reference episode is most likely being
//     expanded from.

import type { TabRow } from "@/components/editor/TabRail";

export interface BuildContextArgs {
  tabs: TabRow[];
  activeTab: TabRow;
  activeTabLiveContent: string | null;
  mode: "edit" | "chat";
  selection?: {
    taggedText: string;
    surroundingContext?: string;
  } | null;
  userMessage?: string;
}

// ─── Tiptap JSON → tagged lines ───

interface TiptapNode {
  type?: string;
  attrs?: { level?: number };
  content?: TiptapNode[];
  text?: string;
}

function textOf(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!node.content) return "";
  return node.content.map(textOf).join("");
}

export function tiptapJsonToTagged(contentStr: string | null): string {
  if (!contentStr) return "";
  let doc: TiptapNode;
  try {
    doc = JSON.parse(contentStr);
  } catch {
    return "";
  }
  const lines: string[] = [];
  const walk = (node: TiptapNode, parent: TiptapNode | null) => {
    if (!node) return;
    const name = node.type;
    if (name === "heading") {
      const level = node.attrs?.level ?? 1;
      const text = textOf(node).trim();
      if (text) lines.push(`[H${level}] ${text}`);
      return;
    }
    if (name === "paragraph" && parent?.type !== "listItem") {
      const text = textOf(node).trim();
      if (text) lines.push(`[P] ${text}`);
      return;
    }
    if (name === "listItem") {
      const tag = parent?.type === "orderedList" ? "[OL]" : "[UL]";
      const text = textOf(node).trim();
      if (text) lines.push(`${tag} ${text}`);
      return;
    }
    if (node.content) {
      for (const child of node.content) walk(child, node);
    }
  };
  if (doc.content) {
    for (const child of doc.content) walk(child, doc);
  }
  return lines.join("\n");
}

// ─── Tab lookups ───

function findTabByType(tabs: TabRow[], type: string): TabRow | undefined {
  // Match by type. Only skip "(archive)" tabs for types where the archive is
  // a known duplicate of a canonical tab's content — today that's just the
  // "Main (archive)" case, which never matches a real type anyway since it
  // carries type="custom". For type="research" the sole instance IS the
  // renamed archive tab (healFixedTabs titles it "Research (archive)" while
  // retaining the research type), and skipping it would lose the Original
  // Plotline source.
  return tabs.find((t) => t.type === type);
}

// ─── Logline extraction ───

function extractLogline(seriesOverviewTagged: string): string {
  if (!seriesOverviewTagged) return "";
  const lines = seriesOverviewTagged.split("\n");
  for (const line of lines) {
    const m = line.match(/^\[P\]\s*Logline:\s*(.+)/i);
    if (m) return `Logline: ${m[1].trim()}`;
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

// ─── H3-section slicing ───
//
// Both the predefined_episodes tab and the microdrama_plots tab hold their
// content as a sequence of [H3] sections. We split by [H3] so the engine
// can address individual episodes/plots.

export interface H3Section {
  title: string;       // the [H3] header text
  content: string;     // tagged lines between this [H3] and the next [H3]/[H2]
  index: number;       // 0-based order within the tab
}

export function splitTabByH3(taggedContent: string): H3Section[] {
  if (!taggedContent) return [];
  const lines = taggedContent.split("\n");
  const sections: H3Section[] = [];
  let current: H3Section | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      sections.push({ ...current, content: buffer.join("\n") });
    }
    buffer = [];
    current = null;
  };

  for (const line of lines) {
    const h3Match = line.match(/^\[H3\]\s*(.+)/);
    const h2Match = /^\[H2\]/.test(line);
    if (h3Match) {
      flush();
      current = { title: h3Match[1].trim(), content: "", index: sections.length };
      buffer.push(line);
      continue;
    }
    if (h2Match) {
      flush();
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

// Detect which H3 section the writer is currently editing. Looks for the
// nearest [H3] line in the selection's tagged text or in the 3 blocks of
// surroundingContext before the selection.
function detectActiveH3Title(
  selectionTaggedText: string,
  surroundingContext: string
): string | null {
  const combined = `${surroundingContext}\n${selectionTaggedText}`;
  const lines = combined.split("\n");
  let last: string | null = null;
  for (const line of lines) {
    const m = line.match(/^\[H3\]\s*(.+)/);
    if (m) last = m[1].trim();
  }
  return last;
}

function findSectionIndexByTitle(
  sections: H3Section[],
  title: string | null
): number {
  if (!title) return -1;
  const normalised = title.trim().toLowerCase();
  return sections.findIndex((s) => s.title.toLowerCase() === normalised);
}

// Extract the leading "Episode N" number from a section title, if present.
export function extractEpisodeNumber(title: string): number | null {
  const m = title.match(/episode\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Given an array of sections, return the ones whose titles reference a
// specific episode number. Used to pair up Episode Plots ↔ Reference
// Episodes by episode number.
function sectionsByEpisodeNumbers(
  sections: H3Section[],
  numbers: number[]
): H3Section[] {
  const nums = new Set(numbers);
  return sections.filter((s) => {
    const n = extractEpisodeNumber(s.title);
    return n != null && nums.has(n);
  });
}

// ─── Main builder ───

export function buildAIContext(args: BuildContextArgs): string {
  const { tabs, activeTab, activeTabLiveContent, selection, userMessage } = args;

  const renderTab = (tab: TabRow | undefined): string => {
    if (!tab) return "";
    if (tab.id === activeTab.id && activeTabLiveContent !== null) {
      return tiptapJsonToTagged(activeTabLiveContent);
    }
    return tiptapJsonToTagged(tab.content);
  };

  const researchTab = findTabByType(tabs, "research");
  const seriesOverviewTab = findTabByType(tabs, "series_overview");
  const charactersTab = findTabByType(tabs, "characters");
  const episodePlotTab = findTabByType(tabs, "microdrama_plots");
  const refEpisodeTab = findTabByType(tabs, "predefined_episodes");
  const skeletonTab = findTabByType(tabs, "series_skeleton");

  const researchTagged = renderTab(researchTab);
  const seriesOverviewTagged = renderTab(seriesOverviewTab);
  const charactersTagged = renderTab(charactersTab);
  const episodePlotTagged = renderTab(episodePlotTab);
  const refEpisodeTagged = renderTab(refEpisodeTab);
  const skeletonTagged = renderTab(skeletonTab);
  const logline = extractLogline(seriesOverviewTagged);

  const activeTagged = renderTab(activeTab);
  const sections: string[] = [];

  // ── Universal context (same regardless of active tab) ──────────────────
  // Phase 1 architecture: every chat message gets the same rich context so
  // tab-switching mid-conversation doesn't silently drop content the AI was
  // referencing. Tab-specific task guidance lives in the system prompt, not
  // in the context assembly.

  // Document manifest.
  const manifestLines = tabs
    .filter((t) => !/\(archive\)/i.test(t.title))
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((t) => {
      const marker = t.id === activeTab.id ? " ← active" : "";
      return `- ${t.title} (${t.type})${marker}`;
    })
    .join("\n");
  sections.push(`## Document Tabs\n${manifestLines}`);

  // Original Research — full content always.
  if (seriesOverviewTagged.trim()) {
    sections.push(`## Original Research\n${seriesOverviewTagged}`);
  }

  // Characters — full always.
  if (charactersTagged) sections.push(`## Characters\n${charactersTagged}`);

  // Series Skeleton — full always (authoritative spine).
  if (skeletonTagged.trim()) {
    sections.push(`## Series Skeleton\n${skeletonTagged}`);
  }

  // All Microdrama Plots — full chain always.
  if (episodePlotTagged) {
    const allPlots = splitTabByH3(episodePlotTagged);
    if (allPlots.length > 0) {
      sections.push(
        `## Microdrama Plots (all ${allPlots.length} episode plots)\n${allPlots.map((s) => s.content).join("\n\n")}`
      );
    }
  }

  // Last 10 Predefined Episodes — capped to keep token cost manageable.
  if (refEpisodeTagged) {
    const allRef = splitTabByH3(refEpisodeTagged);
    if (allRef.length > 0) {
      const cap = 10;
      const slice = allRef.slice(-cap);
      const omitted = allRef.length - slice.length;
      const header = omitted > 0
        ? `## Predefined Episodes (last ${slice.length} of ${allRef.length} — ${omitted} earlier episodes not shown)`
        : `## Predefined Episodes (all ${slice.length})`;
      sections.push(`${header}\n${slice.map((s) => s.content).join("\n\n")}`);
    }
  }

  // ── Task markers (lightweight, no extra content) ────────────────────────
  // These help the AI know exactly where the writer is working and what the
  // next generation target is. They add no large content blocks.

  if (activeTab.type === "predefined_episodes") {
    const selfSections = splitTabByH3(activeTagged);
    const activeTitle = selection
      ? detectActiveH3Title(selection.taggedText, selection.surroundingContext || "")
      : null;
    const curIdx = (() => {
      const i = findSectionIndexByTitle(selfSections, activeTitle);
      if (i >= 0) return i;
      return selfSections.length > 0 ? selfSections.length - 1 : -1;
    })();
    if (episodePlotTagged) {
      const plotSections = splitTabByH3(episodePlotTagged);
      if (plotSections.length > 0) {
        const lastPlot = plotSections[plotSections.length - 1];
        sections.push(
          `## Episode Plot to Generate From (last finalised plot — the one the next reference episode expands from)\n${lastPlot.content}`
        );
      }
    }
    if (curIdx >= 0 && selfSections.length > 0) {
      sections.push(
        `## Currently Editing — "${selfSections[curIdx].title}"\nThis is the reference episode the writer is working on.`
      );
    }
  } else if (activeTab.type === "microdrama_plots") {
    const selfSections = splitTabByH3(activeTagged);
    const activeTitle = selection
      ? detectActiveH3Title(selection.taggedText, selection.surroundingContext || "")
      : null;
    const curIdx = (() => {
      const i = findSectionIndexByTitle(selfSections, activeTitle);
      if (i >= 0) return i;
      return selfSections.length > 0 ? selfSections.length - 1 : -1;
    })();
    if (curIdx >= 0 && selfSections.length > 0) {
      sections.push(
        `## Currently Editing — "${selfSections[curIdx].title}"\nThis is the episode plot the writer is working on.`
      );
    }
  } else if (activeTab.type === "workbook" || activeTab.type === "custom") {
    // For workbook: if the writer's message names an episode number, surface
    // the matching plot so the AI knows exactly which episode to expand from.
    if (episodePlotTagged) {
      const plotSections = splitTabByH3(episodePlotTagged);
      if (plotSections.length > 0) {
        const requestedN = userMessage != null ? extractEpisodeNumber(userMessage) : null;
        const currentPlot = requestedN != null
          ? (plotSections.find((s) => extractEpisodeNumber(s.title) === requestedN) ?? plotSections[plotSections.length - 1])
          : plotSections[plotSections.length - 1];
        const label = requestedN != null
          ? `## Current Episode Plot (Episode ${requestedN} — matched from your message)`
          : `## Current Episode Plot (most recently finalised — the plot the next reference episode expands from)`;
        sections.push(`${label}\n${currentPlot.content}`);
      }
    }
  }

  // Active tab — always last so it's the freshest, most prominent block.
  sections.push(`## Active Tab — ${activeTab.title} (${activeTab.type})\n${activeTagged}`);

  return sections.filter(Boolean).join("\n\n");
}
