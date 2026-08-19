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

// Parse characters or locations tab: each H2 = one entity (name + description).
export function parseH2Entities(
  contentJson: string | null
): Array<{ name: string; description: string }> {
  const tagged = tiptapJsonToTagged(contentJson ?? null);
  return splitByH2(tagged).map((s) => ({
    name: s.heading,
    description: bodyToPlainText(s.body),
  }));
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
    const h3 = line.match(/^\[H3\]\s*(.+)/);
    if (h3) {
      flush();
      // Expect "Episode N: Title" or "Episode N - Title"
      const epMatch = h3[1].match(/^Episode\s+(\d+)[:\s—–-]+(.*)$/i);
      current = {
        episodeNumber: epMatch ? parseInt(epMatch[1], 10) : episodes.length + 1,
        title: epMatch ? epMatch[2].trim() : h3[1].trim(),
        beats: [],
      };
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
