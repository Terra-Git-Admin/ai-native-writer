import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import {
  captureTextSnapshot,
  createOrReuseGenerationRun,
  normalizeComparableText,
} from "@/lib/lineage/content-lineage";
import { contentHash, warnTrace } from "@/lib/saveTrace";

function inputTextFingerprint(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const comparable = normalizeComparableText(text);
  return {
    hash: contentHash(comparable),
    rawLength: text.length,
    comparableLength: comparable.length,
    preview: comparable.slice(0, 240),
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const data = body as {
    sourceSurface?: string;
    snapshotKind?: string;
    textRaw?: string;
    episodeNumber?: unknown;
    episodeTitle?: unknown;
    labRunId?: unknown;
    labTurnId?: unknown;
    turnIndex?: unknown;
    targetPlotText?: unknown;
    targetPlotSectionUid?: unknown;
    selectedPreviousEpisodes?: unknown;
    writerInstruction?: unknown;
    modelId?: unknown;
    promptMode?: unknown;
  };

  if (data.sourceSurface !== "predefined_lab") {
    return NextResponse.json({ error: "Unsupported source surface" }, { status: 400 });
  }
  if (data.snapshotKind !== "first_generation") {
    return NextResponse.json({ error: "Unsupported snapshot kind" }, { status: 400 });
  }
  if (typeof data.textRaw !== "string") {
    return NextResponse.json({ error: "textRaw is required" }, { status: 400 });
  }

  const episodeNumber = Number(data.episodeNumber);
  const safeEpisodeNumber = Number.isInteger(episodeNumber) ? episodeNumber : null;
  const episodeTitle =
    typeof data.episodeTitle === "string" && data.episodeTitle.trim()
      ? data.episodeTitle.trim()
      : safeEpisodeNumber
      ? `Episode ${safeEpisodeNumber}`
      : "Predefined Lab draft";

  try {
    const run = await createOrReuseGenerationRun({
      documentId: id,
      createdBy: session.user.id,
      labRunId: typeof data.labRunId === "string" ? data.labRunId : null,
      targetPlotText: typeof data.targetPlotText === "string" ? data.targetPlotText : null,
      targetPlotSectionUid:
        typeof data.targetPlotSectionUid === "string" ? data.targetPlotSectionUid : null,
      targetEpisodeNumber: safeEpisodeNumber,
      targetTitle: episodeTitle,
      selectedContext: data.selectedPreviousEpisodes ?? null,
      writerInstruction: typeof data.writerInstruction === "string" ? data.writerInstruction : null,
      modelId: typeof data.modelId === "string" ? data.modelId : null,
      promptMode: typeof data.promptMode === "string" ? data.promptMode : null,
    });

    const result = await captureTextSnapshot({
      documentId: id,
      artifactType: "predefined_episode",
      sourceSurface: "predefined_lab",
      snapshotKind: "first_generation",
      createdBy: session.user.id,
      textRaw: data.textRaw,
      episodeNumber: safeEpisodeNumber,
      episodeTitle,
      spineId: run.spineId,
      spineRevisionId: run.spineRevisionId,
      generationRunId: run.generationRunId,
      labRunId: run.generationRunId,
      labTurnId: typeof data.labTurnId === "string" ? data.labTurnId : null,
      turnIndex: typeof data.turnIndex === "number" ? data.turnIndex : null,
      matchConfidence: run.generationRunId ? "high" : "none",
      matchReason: run.generationRunId ? "generation_run_created" : "no_generation_run",
      metadata: {
        captureRoute: "lineage-snapshots",
        selectedPreviousEpisodes: data.selectedPreviousEpisodes ?? null,
        targetPlotSectionUid:
          typeof data.targetPlotSectionUid === "string" ? data.targetPlotSectionUid : null,
        targetPlot: inputTextFingerprint(data.targetPlotText),
      },
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    warnTrace("content.lineage.lab_capture.failed", {
      docId: id,
      userId: session.user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Lineage capture failed" }, { status: 500 });
  }
}
