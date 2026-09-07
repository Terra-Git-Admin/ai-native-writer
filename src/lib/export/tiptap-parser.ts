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
    const explicitName = line.match(/^\[H[123]\]\s*((?:Name|Location)\s*:\s*.+)/i);
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

// Parse series_overview tab: extract Summary and Logline H2 sections.
export function parseSeriesOverview(
  contentJson: string | null
): { summary: string; logline: string } {
  const tagged = tiptapJsonToTagged(contentJson ?? null);
  const sections = splitByH2(tagged);
  const find = (name: string) =>
    sections.find((s) => s.heading.toLowerCase() === name.toLowerCase());

  return {
    summary: bodyToPlainText(find("Summary")?.body ?? ""),
    logline: bodyToPlainText(find("Logline")?.body ?? ""),
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
  const stripped = line.replace(/^\[(P|UL|OL)\]\s*/, "");
  if (!stripped) return null;
  const extract = (prefix: string): string => {
    const re = new RegExp(`${prefix}:\\s*([^|]*)`, "i");
    return stripped.match(re)?.[1]?.trim() ?? "";
  };
  return {
    visual: extract("Visual"),
    dialogue: extract("Dialogue"),
    vo: extract("V\\.O\\."),
  };
}

// Parse predefined_episodes tab: each H3 = one episode.
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
    const episodeHeading = line.match(/^\[H[123]\]\s*(Episode\s+\d+(?:\s*[:—–-]\s*.*)?)$/i);
    const anyHeading = line.match(/^\[H[123]\]\s*(.+)/);
    if (episodeHeading) {
      flush();
      // Accept "Episode N", "Episode N: Title", or "Episode N - Title".
      const epMatch = episodeHeading[1].match(/^Episode\s+(\d+)(?:\s*[:—–-]\s*(.*))?$/i);
      const episodeNumber = epMatch ? parseInt(epMatch[1], 10) : episodes.length + 1;
      const parsedTitle = epMatch ? epMatch[2]?.trim() : null;
      current = {
        episodeNumber,
        title: parsedTitle || episodeHeading[1].trim() || `Episode ${episodeNumber}`,
        beats: [],
      };
      continue;
    }
    if (anyHeading) {
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
