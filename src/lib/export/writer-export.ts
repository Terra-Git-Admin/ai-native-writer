import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { tabs, handoffExports } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import {
  filterTiptapEpisodesByRange,
  parseSeriesOverview,
  parseH2Entities,
  parsePredefinedEpisodes,
  type EpisodeRange,
} from "./tiptap-parser";
import { contentHash, logEvent } from "@/lib/saveTrace";

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
    beats: Array<{ visual: string; dialogue: string; vo: string }>;
  }>;
  episodeRange: {
    from: number;
    to: number;
    availableEpisodes: number;
    selectedEpisodes: number;
  } | null;
}

export interface WriterExportOptions {
  episodeRange?: EpisodeRange;
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
  const episodeRange = options.episodeRange;
  const allEpisodes = parsePredefinedEpisodes(episodesTab?.content ?? null);
  const selectedEpisodesContent = filterTiptapEpisodesByRange(
    episodesTab?.content ?? null,
    episodeRange
  );

  const { summary, logline } = parseSeriesOverview(overviewTab?.content ?? null);
  const characters = parseH2Entities(charactersTab?.content ?? null);
  const locations = parseH2Entities(locationsTab?.content ?? null);
  const episodes = parsePredefinedEpisodes(selectedEpisodesContent);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const exportId = nanoid();
  const tabSnapshots: WriterExportTabSnapshot[] = allTabs.map((tab) => {
    const contentJson =
      tab.type === "predefined_episodes" ? selectedEpisodesContent : tab.content;
    return {
      id: tab.id,
      title: tab.title,
      type: tab.type,
      position: tab.position,
      contentJson,
      contentTagged: tiptapJsonToTagged(contentJson ?? null),
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
    episodeRange: episodeRange
      ? {
          from: episodeRange.from,
          to: episodeRange.to,
          availableEpisodes: allEpisodes.length,
          selectedEpisodes: episodes.length,
        }
      : null,
  };

  const exportJson = JSON.stringify(writerExport);

  logEvent("export.build.snapshot", {
    documentId,
    userId,
    exportId,
    mode: "last_saved_no_flush",
    episodeRange: writerExport.episodeRange,
    tabCount: tabSnapshots.length,
    payloadBytes: exportJson.length,
    payloadHash: contentHash(exportJson),
    tabs: tabSnapshots.map((tab) => ({
      type: tab.type,
      title: tab.title,
      updatedAt: tab.updatedAt,
      contentBytes: tab.contentJson?.length ?? 0,
    })),
  });

  await db.insert(handoffExports).values({
    id: exportId,
    documentId,
    createdBy: userId,
    exportJson,
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
