import { createHash, randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import * as schema from "@/lib/db/schema";
import { documents, tabs } from "@/lib/db/schema";
import { extractEpisodeSections } from "@/lib/editor/episode-sections";
import type {
  PlotLabReferenceInput,
  PlotLabReferenceSnapshot,
  PlotLabSourcePacket,
} from "@/lib/plot-lab-v2/contracts";

type Database = BetterSQLite3Database<typeof schema>;

export class PlotLabSnapshotError extends Error {
  readonly code: "DOCUMENT_NOT_FOUND" | "URL_REFERENCES_NOT_AVAILABLE" | "REFERENCE_TOO_LARGE";

  constructor(code: PlotLabSnapshotError["code"], message: string) {
    super(message);
    this.name = "PlotLabSnapshotError";
    this.code = code;
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function firstEpisode(content: string | null): string | undefined {
  return extractEpisodeSections(content).find((episode) => episode.number === 1)?.text;
}

export async function capturePlotLabStartSnapshot(
  database: Database,
  documentId: string,
  referenceInputs: PlotLabReferenceInput[],
  now = new Date()
): Promise<{
  orientation: "portrait" | "landscape";
  sourceSnapshot: PlotLabSourcePacket;
  sourceHashes: Record<string, string>;
  referenceSnapshots: PlotLabReferenceSnapshot[];
}> {
  const document = database
    .select({ id: documents.id, orientation: documents.orientation })
    .from(documents)
    .where(eq(documents.id, documentId))
    .get();
  if (!document) {
    throw new PlotLabSnapshotError("DOCUMENT_NOT_FOUND", "The document no longer exists.");
  }

  const rows = database
    .select({ type: tabs.type, content: tabs.content })
    .from(tabs)
    .where(eq(tabs.documentId, documentId))
    .orderBy(asc(tabs.position))
    .all();
  const contentFor = (type: string): string | null =>
    rows.find((row) => row.type === type)?.content ?? null;

  const sourceSnapshot: PlotLabSourcePacket = {
    episode1Plot: firstEpisode(contentFor("microdrama_plots")),
    episode1Script: firstEpisode(contentFor("predefined_episodes")),
    characters: tiptapJsonToTagged(contentFor("characters")) || undefined,
    originalResearch: tiptapJsonToTagged(contentFor("series_overview")) || undefined,
  };
  const sourceHashes = Object.fromEntries(
    Object.entries(sourceSnapshot)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([key, value]) => [key, hashText(value)])
  );
  sourceHashes.orientation = hashText(document.orientation);

  const capturedAt = now.toISOString();
  const referenceSnapshots = referenceInputs.map((reference) => {
    if (reference.type === "url") {
      throw new PlotLabSnapshotError(
        "URL_REFERENCES_NOT_AVAILABLE",
        "URL references will be enabled with the safe-fetch phase. Paste the relevant text for now."
      );
    }
    const capturedText = reference.text.trim();
    if (capturedText.length > 20_000) {
      throw new PlotLabSnapshotError(
        "REFERENCE_TOO_LARGE",
        "A pasted reference cannot exceed 20,000 characters in this phase."
      );
    }
    return {
      id: randomUUID(),
      type: "text" as const,
      capturedText,
      contentHash: hashText(capturedText),
      capturedAt,
    };
  });

  return {
    orientation: document.orientation,
    sourceSnapshot,
    sourceHashes,
    referenceSnapshots,
  };
}
