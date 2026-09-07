import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { tabs, handoffExports } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { taggedTextToTiptapDoc } from "@/lib/editor/tagged-parser";
import {
  parseSeriesOverview,
  parseH2Entities,
  parsePredefinedEpisodes,
  type EpisodeBeat,
} from "./tiptap-parser";

export interface WriterExportTabSnapshot {
  id: string;
  title: string;
  type: string;
  position: number;
  contentJson: string | null;
  contentTagged: string;
  updatedAt: string;
}

export interface WriterExport {
  exportId: string;
  documentId: string;
  exportedAt: string;
  version: 1;
  tabs: WriterExportTabSnapshot[];
  series: {
    title: string;
    summary: string;
    logline: string;
  };
  characters: Array<{ name: string; description: string }>;
  locations: Array<{ name: string; description: string }>;
  episodes: Array<{
    episodeNumber: number;
    title: string;
    beats: EpisodeBeat[];
  }>;
}

export interface WriterExportOptions {
  episodeRange?: {
    from: number;
    to: number;
  };
}

type ExportEntity = { name: string; description: string };

function serializeEntitiesToTagged(entities: ExportEntity[]): string {
  return entities
    .map((entity) => {
      const description = entity.description
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `[P] ${line}`)
        .join("\n");
      return [`[H2] ${entity.name}`, description].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function serializeTaggedToJson(tagged: string): string | null {
  const trimmed = tagged.trim();
  if (!trimmed) return null;
  return JSON.stringify(taggedTextToTiptapDoc(trimmed));
}

function stripOverviewEpisodeSections(tagged: string): string {
  const lines = tagged.split("\n");
  const filtered: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const h2 = line.match(/^\[H2\]\s*(.+)$/);
    if (h2) {
      skipping = /^original\s+episodes?$/i.test(h2[1].trim());
    }
    if (!skipping) filtered.push(line);
  }

  return filtered.join("\n").trim();
}

export async function buildExport(
  documentId: string,
  documentTitle: string,
  userId: string,
  requestBaseUrl?: string,
  options: WriterExportOptions = {}
): Promise<{ exportId: string; exportUrl: string; export: WriterExport }> {
  const allTabs = await db.query.tabs.findMany({
    where: eq(tabs.documentId, documentId),
    orderBy: [asc(tabs.position), asc(tabs.createdAt)],
  });

  const findTab = (type: string) => allTabs.find((t) => t.type === type);

  const overviewTab = findTab("series_overview");
  const charactersTab = findTab("characters");
  const locationsTab = findTab("locations");
  const episodesTab = findTab("predefined_episodes");

  const { summary, logline } = parseSeriesOverview(overviewTab?.content ?? null);
  const allCharacters = parseH2Entities(charactersTab?.content ?? null);
  const allLocations = parseH2Entities(locationsTab?.content ?? null);
  const allEpisodes = parsePredefinedEpisodes(episodesTab?.content ?? null);
  const episodeRange = options.episodeRange;
  const selectedEpisodes = episodeRange
    ? allEpisodes.filter(
        (episode) =>
          episode.episodeNumber >= episodeRange.from &&
          episode.episodeNumber <= episodeRange.to
      )
    : allEpisodes;
  const characters = allCharacters;
  const locations = allLocations;
  const episodes = selectedEpisodes.map(({ episodeNumber, title, beats }) => ({
    episodeNumber,
    title,
    beats,
  }));

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const exportId = nanoid();
  const relevantTypes = new Set([
    "series_overview",
    "characters",
    "locations",
    "predefined_episodes",
  ]);
  const tabSnapshots: WriterExportTabSnapshot[] = allTabs
    .filter((tab) => relevantTypes.has(tab.type))
    .map((tab) => {
      let contentTagged = tiptapJsonToTagged(tab.content ?? null);
      if (tab.type === "series_overview" && episodeRange) {
        contentTagged = stripOverviewEpisodeSections(contentTagged);
      } else if (tab.type === "characters") {
        contentTagged = serializeEntitiesToTagged(allCharacters);
      } else if (tab.type === "locations") {
        contentTagged = serializeEntitiesToTagged(allLocations);
      } else if (tab.type === "predefined_episodes") {
        contentTagged = selectedEpisodes
          .map((episode) => episode.sourceTagged)
          .filter(Boolean)
          .join("\n\n");
      }

      return {
        id: tab.id,
        title: tab.title,
        type: tab.type,
        position: tab.position,
        contentJson: serializeTaggedToJson(contentTagged),
        contentTagged,
        updatedAt: tab.updatedAt.toISOString(),
      };
    });

  const writerExport: WriterExport = {
    exportId,
    documentId,
    exportedAt: now.toISOString(),
    version: 1,
    tabs: tabSnapshots,
    series: { title: documentTitle, summary, logline },
    characters,
    locations,
    episodes,
  };

  await db.insert(handoffExports).values({
    id: exportId,
    documentId,
    createdBy: userId,
    exportJson: JSON.stringify(writerExport),
    createdAt: now,
    expiresAt,
  });

  const baseUrl =
    requestBaseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://ai-native-writer-936494534526.asia-south1.run.app";

  return {
    exportId,
    exportUrl: `${baseUrl}/api/export/${exportId}`,
    export: writerExport,
  };
}
