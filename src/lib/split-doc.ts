// Splits a Tiptap JSON document into per-section typed tabs.
//
// Each top-level [H2] section becomes its own tab. Inside the tab body the
// [H2] is promoted to [H1] so the writer sees a proper page title. [H3]
// children are left intact — the nested outline (episodes inside the
// Reference Episodes tab, plots inside the Episode Plots tab) is rendered
// from those [H3] headings at display time.
//
// Canonical [H2] titles map to typed tabs via inferTabType. Anything else
// becomes a "custom" tab titled after its [H2]. Content before the first
// [H2] (typically the series [H1] + logline) is merged into the Series
// Overview tab if one exists, otherwise stands alone.

import { inferTabType } from "./tab-type-inference";

interface TiptapNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: unknown[];
}

function nodeText(node: TiptapNode): string {
  if (typeof node?.text === "string") return node.text;
  if (!node?.content) return "";
  return node.content.map(nodeText).join("");
}

function serialise(nodes: TiptapNode[]): string {
  return JSON.stringify({ type: "doc", content: nodes });
}

export interface SectionTab {
  title: string;
  type:
    | "custom"
    | "series_overview"
    | "characters"
    | "microdrama_plots"
    | "predefined_episodes"
    | "workbook"
    | "research";
  sequenceNumber: number | null;
  content: string;
}

// Promote a plain [H2] title into a Heading level-1 node so the split tab
// body reads as a proper page with its title on top.
function h1HeadingNode(title: string): TiptapNode {
  return {
    type: "heading",
    // textAlign: null matches Tiptap's round-trip output (TextAlign extension
    // adds it on load). Without it the first poll after doc open sees a
    // normalisation mismatch and fires a false conflict banner.
    attrs: { textAlign: null, level: 1 },
    content: [{ type: "text", text: title }],
  };
}

export function splitTiptapDocument(rawContent: string | null): SectionTab[] {
  if (!rawContent) return [];
  let doc: TiptapNode;
  try {
    doc = JSON.parse(rawContent);
  } catch {
    return [];
  }
  const children: TiptapNode[] = Array.isArray(doc.content) ? doc.content : [];
  if (children.length === 0) return [];

  const sections: SectionTab[] = [];
  const preludeNodes: TiptapNode[] = [];

  let curTitle: string | null = null;
  let curNodes: TiptapNode[] = [];

  const flushSection = () => {
    if (!curTitle) return;
    const inferred = inferTabType(curTitle);
    // Prepend the promoted H1 so the tab body has its title as the first
    // block. [H3] children (episodes inside a Reference Episodes tab, plots
    // inside an Episode Plots tab) are preserved inline and become the
    // nested outline rendered by TabRail.
    const body: TiptapNode[] = [h1HeadingNode(curTitle), ...curNodes];
    sections.push({
      title: curTitle,
      type: inferred.type,
      sequenceNumber: null,
      content: serialise(body),
    });
    curTitle = null;
    curNodes = [];
  };

  for (const node of children) {
    const isH2 = node.type === "heading" && node.attrs?.level === 2;
    if (isH2) {
      flushSection();
      curTitle = nodeText(node).trim();
      continue;
    }
    if (curTitle) {
      curNodes.push(node);
    } else {
      preludeNodes.push(node);
    }
  }
  flushSection();

  if (preludeNodes.length > 0) {
    const overviewIdx = sections.findIndex((s) => s.type === "series_overview");
    if (overviewIdx >= 0) {
      // Prepend prelude to the Series Overview body, after the promoted H1.
      const existing = JSON.parse(sections[overviewIdx].content).content as TiptapNode[];
      const [h1Node, ...rest] = existing;
      sections[overviewIdx] = {
        ...sections[overviewIdx],
        content: serialise([h1Node, ...preludeNodes, ...rest]),
      };
    } else {
      sections.unshift({
        title: "Series Overview",
        type: "series_overview",
        sequenceNumber: null,
        content: serialise([h1HeadingNode("Series Overview"), ...preludeNodes]),
      });
    }
  }

  return sections;
}

export function shouldSplit(rawContent: string | null): boolean {
  if (!rawContent) return false;
  try {
    const doc = JSON.parse(rawContent) as TiptapNode;
    const children = doc.content || [];
    const h2s = children.filter(
      (n) => n.type === "heading" && n.attrs?.level === 2
    );
    return h2s.length >= 2;
  } catch {
    return false;
  }
}
