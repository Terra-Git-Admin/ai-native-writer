import { tiptapJsonToTagged } from "@/lib/ai/context-engine";

export interface H2Section {
  heading: string;
  body: string;
}

export interface EpisodeBeat {
  visual: string;
  dialogue: string;
  vo: string;
}

export interface ParsedEpisode {
  episodeNumber: number;
  title: string;
  beats: EpisodeBeat[];
}

interface TiptapNode {
  type?: string;
  attrs?: { level?: number };
  content?: TiptapNode[];
  text?: string;
}

export interface EpisodeRange {
  from: number;
  to: number;
}

function textOf(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!node.content) return "";
  return node.content.map(textOf).join("");
}

export function parseEpisodeHeading(
  text: string
): { episodeNumber: number; title: string } | null {
  const match = text.match(/^Episode\s+(\d+)(?:\s*[:\u2014\u2013-]\s*(.*))?$/i);
  if (!match) return null;
  const episodeNumber = Number(match[1]);
  if (!Number.isInteger(episodeNumber)) return null;
  return {
    episodeNumber,
    title: match[2]?.trim() || `Episode ${episodeNumber}`,
  };
}

function episodeHeadingFromNode(
  node: TiptapNode
): { episodeNumber: number; title: string } | null {
  if (node.type !== "heading") return null;
  return parseEpisodeHeading(textOf(node).trim());
}

export function filterTiptapEpisodesByRange(
  contentJson: string | null,
  range?: EpisodeRange
): string | null {
  if (!contentJson || !range) return contentJson;

  let doc: TiptapNode;
  try {
    doc = JSON.parse(contentJson);
  } catch {
    return contentJson;
  }

  if (!Array.isArray(doc.content)) return contentJson;

  const filtered: TiptapNode[] = [];
  let seenFirstEpisode = false;
  let includeCurrentEpisode = false;

  for (const node of doc.content) {
    const episodeHeading = episodeHeadingFromNode(node);
    if (episodeHeading) {
      seenFirstEpisode = true;
      includeCurrentEpisode =
        episodeHeading.episodeNumber >= range.from &&
        episodeHeading.episodeNumber <= range.to;
      if (includeCurrentEpisode) filtered.push(node);
      continue;
    }

    if (!seenFirstEpisode || includeCurrentEpisode) {
      filtered.push(node);
    }
  }

  return JSON.stringify({ ...doc, content: filtered });
}

// Split tagged content by [H2] headings into one section per H2.
function splitByH2(tagged: string): H2Section[] {
  if (!tagged) return [];
  const lines = tagged.split("\n");
  const sections: H2Section[] = [];
  let current: H2Section | null = null;
  const buffer: string[] = [];

  const flush = () => {
    if (current) {
      sections.push({ ...current, body: buffer.join("\n").trim() });
      buffer.length = 0;
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^\[H2\]\s*(.+)/);
    if (h2) {
      flush();
      current = { heading: h2[1].trim(), body: "" };
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

// Split character/location tabs by explicit name headings. Older docs and
// pasted imports often store entity names as H1 "Name: ..." blocks, not H2.
function splitByEntityHeading(tagged: string): H2Section[] {
  if (!tagged) return [];
  const lines = tagged.split("\n");
  const sections: H2Section[] = [];
  let current: H2Section | null = null;
  const buffer: string[] = [];

  const flush = () => {
    if (current) {
      sections.push({ ...current, body: buffer.join("\n").trim() });
      buffer.length = 0;
    }
  };

  for (const line of lines) {
    const explicitName = line.match(/^\[(?:H[123]|P|UL|OL)\]\s*((?:Name|Location)\s*:\s*.+)/i);
    const anyHeading = line.match(/^\[H[123]\]\s*(.+)/);
    if (explicitName) {
      flush();
      current = { heading: explicitName[1].trim(), body: "" };
      continue;
    }
    if (anyHeading) {
      flush();
      current = null;
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

// Extract plain text from a tagged body (strips [P], [UL], [OL] tags).
function bodyToPlainText(body: string): string {
  return body
    .split("\n")
    .map((l) => l.replace(/^\[(P|UL|OL|H\d)\]\s*/, ""))
    .filter(Boolean)
    .join("\n");
}

// Parse series_overview tab: extract Summary and Logline sections.
export function parseSeriesOverview(
  contentJson: string | null
): { summary: string; logline: string } {
  const tagged = tiptapJsonToTagged(contentJson ?? null);
  const sections = splitByH2(tagged);
  const find = (name: string) =>
    sections.find((s) => s.heading.toLowerCase() === name.toLowerCase());
  const findLoose = (names: string[]) =>
    sections.find((s) => names.includes(s.heading.toLowerCase()));
  const findInline = (label: string) => {
    const match = tagged.match(
      new RegExp(`^\\[(?:P|UL|OL)\\]\\s*${label}:\\s*(.+)$`, "im")
    );
    return match?.[1]?.trim() ?? "";
  };

  return {
    summary:
      bodyToPlainText(findLoose(["summary", "series summary"])?.body ?? "") ||
      findInline("Summary"),
    logline: bodyToPlainText(find("Logline")?.body ?? "") || findInline("Logline"),
  };
}

function normalizeEntityName(name: string): string {
  return name.replace(/^(?:Name|Location)\s*:\s*/i, "").trim();
}

// Parse characters or locations tab: each explicit Name:/Location: heading is
// one entity. Fall back to H2 sections for older manually structured docs.
export function parseH2Entities(
  contentJson: string | null
): Array<{ name: string; description: string }> {
  const tagged = tiptapJsonToTagged(contentJson ?? null);
  const sections = splitByEntityHeading(tagged);
  const entitySections = sections.length > 0 ? sections : splitByH2(tagged);
  return entitySections
    .map((s) => ({
      name: normalizeEntityName(s.heading),
      description: bodyToPlainText(s.body),
    }))
    .filter(
      (entity) =>
        entity.name &&
        !["characters", "locations"].includes(entity.name.toLowerCase())
    );
}

// Parse a single beat line: "Visual: ... | Dialogue: ... | V.O.: ..."
function parseBeatLine(line: string): EpisodeBeat | null {
  const stripped = line
    .replace(/^\[(P|UL|OL)\]\s*/, "")
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  if (!stripped) return null;
  const extract = (prefix: string): string => {
    const re = new RegExp(`${prefix}:\\s*([^|]*)`, "i");
    return stripped.match(re)?.[1]?.trim() ?? "";
  };
  return {
    visual: extract("Visual"),
    dialogue: extract("Dialogue"),
    vo: extract("V\\.?O\\.?"),
  };
}

// Parse predefined_episodes tab: each Episode heading is one episode.
export function parsePredefinedEpisodes(
  contentJson: string | null
): ParsedEpisode[] {
  const tagged = tiptapJsonToTagged(contentJson ?? null);
  if (!tagged) return [];

  const lines = tagged.split("\n");
  const episodes: ParsedEpisode[] = [];
  let current: ParsedEpisode | null = null;

  const flush = () => {
    if (current) episodes.push(current);
    current = null;
  };

  for (const line of lines) {
    const heading = line.match(/^\[H[123]\]\s*(.+)/);
    const parsedHeading = heading ? parseEpisodeHeading(heading[1].trim()) : null;
    if (parsedHeading) {
      flush();
      current = {
        episodeNumber: parsedHeading.episodeNumber,
        title: parsedHeading.title,
        beats: [],
      };
      continue;
    }
    if (heading) {
      flush();
      current = null;
      continue;
    }
    if (current) {
      const beat = parseBeatLine(line);
      if (beat && (beat.visual || beat.dialogue || beat.vo)) {
        current.beats.push(beat);
      }
    }
  }
  flush();
  return episodes;
}
