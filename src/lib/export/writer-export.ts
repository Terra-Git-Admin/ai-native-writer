import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { tabs, handoffExports } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import {
  parseSeriesOverview,
  parseH2Entities,
  parsePredefinedEpisodes,
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
    beats: Array<{ visual: string; dialogue: string; vo: string }>;
  }>;
}

export async function buildExport(
  documentId: string,
  documentTitle: string,
  userId: string
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
  const characters = parseH2Entities(charactersTab?.content ?? null);
  const locations = parseH2Entities(locationsTab?.content ?? null);
  const episodes = parsePredefinedEpisodes(episodesTab?.content ?? null);

  const exportId = nanoid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const tabSnapshots: WriterExportTabSnapshot[] = allTabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    type: tab.type,
    position: tab.position,
    contentJson: tab.content,
    contentTagged: tiptapJsonToTagged(tab.content ?? null),
    updatedAt: tab.updatedAt.toISOString(),
  }));

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
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://ai-native-writer-936494534526.asia-south1.run.app";

  return {
    exportId,
    exportUrl: `${baseUrl}/api/export/${exportId}`,
    export: writerExport,
  };
}
