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
// For reference_episode and episode_plot tabs, the AI also sees:
//   - Previous 3 [H3] sections in the SAME tab (sliced around the writer's
//     cursor/selection), since episodes and plots both live as [H3] blocks
//     inside one parent tab.
//   - Cross-tab neighbours: nearby plots when editing a ref episode; last
//     3 reference episodes when editing a plot.

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
  // Skip archive tabs — they're duplicates of content already in typed tabs.
  return tabs.find(
    (t) => t.type === type && !/\(archive\)/i.test(t.title)
  );
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
// Both the reference_episode tab and the episode_plot tab hold their
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
function extractEpisodeNumber(title: string): number | null {
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
  const { tabs, activeTab, activeTabLiveContent, selection } = args;

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
  const episodePlotTab = findTabByType(tabs, "episode_plot");
  const refEpisodeTab = findTabByType(tabs, "reference_episode");

  const researchTagged = renderTab(researchTab);
  const seriesOverviewTagged = renderTab(seriesOverviewTab);
  const charactersTagged = renderTab(charactersTab);
  const episodePlotTagged = renderTab(episodePlotTab);
  const refEpisodeTagged = renderTab(refEpisodeTab);
  const logline = extractLogline(seriesOverviewTagged);

  const activeTagged = renderTab(activeTab);
  const sections: string[] = [];

  // Document manifest.
  const manifestLines = tabs
    .filter((t) => !/\(archive\)/i.test(t.title))
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((t) => {
      const marker = t.id === activeTab.id ? " (active)" : "";
      return `- ${t.title} — type: ${t.type}${marker}`;
    })
    .join("\n");
  sections.push(`## Document Tabs\n${manifestLines}`);

  // Baseline.
  if (logline) sections.push(`## Series Logline\n${logline}`);
  if (researchTagged) sections.push(`## Original Plotline (Research / source material)\n${researchTagged}`);
  if (charactersTagged) sections.push(`## Characters\n${charactersTagged}`);

  // Recipe-specific.
  if (activeTab.type === "reference_episode") {
    // All episodes live as [H3] sections in this tab. Slice.
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
      const current = selfSections[curIdx];
      const prevStart = Math.max(0, curIdx - 3);
      const previous = selfSections.slice(prevStart, curIdx);
      if (previous.length > 0) {
        const body = previous
          .map((s) => s.content)
          .join("\n\n");
        sections.push(
          `## Previous Reference Episodes (last ${previous.length}, from this tab)\n${body}`
        );
      }

      // Pair with nearby plots by episode number.
      const curEpNum = extractEpisodeNumber(current.title);
      if (episodePlotTagged && curEpNum != null) {
        const plotSections = splitTabByH3(episodePlotTagged);
        const plotNumbers: number[] = [];
        for (let n = curEpNum - 3; n <= curEpNum + 3; n++) {
          if (n !== curEpNum && n > 0) plotNumbers.push(n);
        }
        const nearbyPlots = sectionsByEpisodeNumbers(plotSections, plotNumbers);
        if (nearbyPlots.length > 0) {
          sections.push(
            `## Surrounding Episode Plots (for Eps ${plotNumbers.join(", ")})\n${nearbyPlots.map((s) => s.content).join("\n\n")}`
          );
        }
      }

      sections.push(`## Currently Editing — "${current.title}"\nThis is the section the writer is working on.`);
    }
  } else if (activeTab.type === "episode_plot") {
    // Plots as [H3] sections in this tab.
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
      const current = selfSections[curIdx];
      const prevStart = Math.max(0, curIdx - 3);
      const previous = selfSections.slice(prevStart, curIdx);
      if (previous.length > 0) {
        sections.push(
          `## Previous Episode Plots (last ${previous.length}, from this tab)\n${previous.map((s) => s.content).join("\n\n")}`
        );
      }
      const nextEnd = Math.min(selfSections.length, curIdx + 4);
      const upcoming = selfSections.slice(curIdx + 1, nextEnd);
      if (upcoming.length > 0) {
        sections.push(
          `## Upcoming Episode Plots (next ${upcoming.length}, from this tab)\n${upcoming.map((s) => s.content).join("\n\n")}`
        );
      }

      // Last 3 reference episodes for realised-tone context.
      if (refEpisodeTagged) {
        const refSections = splitTabByH3(refEpisodeTagged);
        const curEpNum = extractEpisodeNumber(current.title);
        let refSlice: H3Section[] = [];
        if (curEpNum != null) {
          const nums = [curEpNum - 3, curEpNum - 2, curEpNum - 1].filter((n) => n > 0);
          refSlice = sectionsByEpisodeNumbers(refSections, nums);
        }
        if (refSlice.length === 0 && refSections.length > 0) {
          refSlice = refSections.slice(-3);
        }
        if (refSlice.length > 0) {
          sections.push(
            `## Most Recent Reference Episodes (last ${refSlice.length})\n${refSlice.map((s) => s.content).join("\n\n")}`
          );
        }
      }

      sections.push(`## Currently Editing — "${current.title}"\nThis is the plot the writer is working on.`);
    }
  }

  // Active tab — last so it's the freshest block.
  sections.push(`## Active Tab — ${activeTab.title} (${activeTab.type})\n${activeTagged}`);

  return sections.filter(Boolean).join("\n\n");
}
