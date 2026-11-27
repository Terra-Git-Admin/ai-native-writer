import { createHash } from "crypto";

interface TiptapNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

export interface EpisodeSection {
  episodeNumber: number;
  title: string;
  content: string;
  sectionUid: string | null;
  hash: string;
}

export interface BulkPreview {
  eligible: EpisodeSection[];
  skipped: EpisodeSection[];
  issues: string[];
  planHash: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function textOf(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function taggedLine(node: TiptapNode): string | null {
  const text = textOf(node).trim();
  if (!text) return null;
  if (node.type === "heading") {
    const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
    return `[H${level}] ${text}`;
  }
  if (node.type === "paragraph") return `[P] ${text}`;
  if (node.type === "orderedList" || node.type === "bulletList") {
    const tag = node.type === "orderedList" ? "[OL]" : "[UL]";
    return (node.content ?? [])
      .map((item) => textOf(item).trim())
      .filter(Boolean)
      .map((item) => `${tag} ${item}`)
      .join("\n");
  }
  return null;
}

function episodeNumber(title: string): number | null {
  const match = title.match(/\b(?:episode|ep)\s*#?\s*(\d+)\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseEpisodeSections(contentJson: string | null): EpisodeSection[] {
  if (!contentJson) return [];
  let doc: TiptapNode;
  try {
    doc = JSON.parse(contentJson) as TiptapNode;
  } catch {
    return [];
  }
  if (doc.type !== "doc") return [];

  const sections: EpisodeSection[] = [];
  let current: { title: string; episodeNumber: number; sectionUid: string | null; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    if (content.split("\n").some((line) => /^\[(P|UL|OL)\]/.test(line))) {
      sections.push({
        episodeNumber: current.episodeNumber,
        title: current.title,
        content,
        sectionUid: current.sectionUid,
        hash: hash(content),
      });
    }
    current = null;
  };

  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      const title = textOf(node).trim();
      const number = episodeNumber(title);
      if (number != null) {
        flush();
        current = {
          title,
          episodeNumber: number,
          sectionUid: typeof node.attrs?.anwSectionUid === "string" ? node.attrs.anwSectionUid : null,
          lines: [taggedLine(node)].filter(Boolean) as string[],
        };
        continue;
      }
      flush();
      continue;
    }
    if (current) {
      const line = taggedLine(node);
      if (line) current.lines.push(line);
    }
  }
  flush();
  return sections;
}

function duplicates(sections: EpisodeSection[]): number[] {
  const seen = new Set<number>();
  const repeated = new Set<number>();
  for (const section of sections) {
    if (seen.has(section.episodeNumber)) repeated.add(section.episodeNumber);
    seen.add(section.episodeNumber);
  }
  return [...repeated].sort((a, b) => a - b);
}

function hasBodyWithoutEpisodeHeading(contentJson: string | null, parsed: EpisodeSection[]): boolean {
  if (!contentJson || parsed.length > 0) return false;
  try {
    const doc = JSON.parse(contentJson) as TiptapNode;
    return (doc.content ?? []).some((node) => Boolean(textOf(node).trim()));
  } catch {
    return true;
  }
}

export function buildBulkPreview(
  plotsContent: string | null,
  predefinedContent: string | null
): BulkPreview {
  const plots = parseEpisodeSections(plotsContent);
  const predefined = parseEpisodeSections(predefinedContent);
  const issues: string[] = [];
  const duplicatePlots = duplicates(plots);
  const duplicatePredefined = duplicates(predefined);
  if (duplicatePlots.length) issues.push(`Duplicate Microdrama Plot episode numbers: ${duplicatePlots.join(", ")}.`);
  if (duplicatePredefined.length) issues.push(`Duplicate Predefined Episode numbers: ${duplicatePredefined.join(", ")}.`);
  if (hasBodyWithoutEpisodeHeading(plotsContent, plots)) {
    issues.push("Microdrama Plots has content but no numbered episode headings with bodies.");
  }
  if (hasBodyWithoutEpisodeHeading(predefinedContent, predefined)) {
    issues.push("Predefined Episodes has content but no numbered episode headings, so existing episodes cannot be matched safely.");
  }

  const existing = new Set(predefined.map((section) => section.episodeNumber));
  const sorted = [...plots].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const eligible = sorted.filter((section) => !existing.has(section.episodeNumber));
  const skipped = sorted.filter((section) => existing.has(section.episodeNumber));
  return {
    eligible,
    skipped,
    issues,
    planHash: hash(JSON.stringify({
      plots: sorted.map((section) => [section.episodeNumber, section.hash]),
      predefined: [...existing].sort((a, b) => a - b),
    })),
  };
}
