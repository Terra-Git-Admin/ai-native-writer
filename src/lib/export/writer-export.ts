import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { tabs, handoffExports } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import {
  filterTiptapEpisodesByRange,
  parseSeriesOverview,
  parsePredefinedEpisodes,
  type EpisodeRange,
} from "./tiptap-parser";
import { contentHash, logEvent } from "@/lib/saveTrace";

export interface WriterExportPredefinedSnapshot {
  contentJson: string | null;
  contentTagged: string;
  updatedAt: string | null;
}

export interface WriterExport {
  exportId: string;
  documentId: string;
  exportedAt: string;
  version: 2;
  series: {
    title: string;
    summary: string;
    logline: string;
  };
  predefinedEpisodes: WriterExportPredefinedSnapshot;
  episodeRange: {
    from: number;
    to: number;
    availableEpisodes: number;
    selectedEpisodes: number;
    selectedEpisodeDetails: Array<{ episodeNumber: number; title: string }>;
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
  const episodesTab = findTab("predefined_episodes");
  const episodeRange = options.episodeRange;
  const allEpisodes = parsePredefinedEpisodes(episodesTab?.content ?? null);
  const selectedEpisodesContent = filterTiptapEpisodesByRange(
    episodesTab?.content ?? null,
    episodeRange
  );

  const { summary, logline } = parseSeriesOverview(overviewTab?.content ?? null);
  const selectedEpisodes = parsePredefinedEpisodes(selectedEpisodesContent);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const exportId = nanoid();
  const predefinedEpisodes: WriterExportPredefinedSnapshot = {
    contentJson: selectedEpisodesContent,
    contentTagged: tiptapJsonToTagged(selectedEpisodesContent ?? null),
    updatedAt: episodesTab?.updatedAt.toISOString() ?? null,
  };

  const writerExport: WriterExport = {
    exportId,
    documentId,
    exportedAt: now.toISOString(),
    version: 2,
    series: { title: documentTitle, summary, logline },
    predefinedEpisodes,
    episodeRange: episodeRange
      ? {
          from: episodeRange.from,
          to: episodeRange.to,
          availableEpisodes: allEpisodes.length,
          selectedEpisodes: selectedEpisodes.length,
          selectedEpisodeDetails: selectedEpisodes.map((episode) => ({
            episodeNumber: episode.episodeNumber,
            title: episode.title,
          })),
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
    predefinedUpdatedAt: predefinedEpisodes.updatedAt,
    payloadBytes: exportJson.length,
    payloadHash: contentHash(exportJson),
    predefinedBytes: predefinedEpisodes.contentJson?.length ?? 0,
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
