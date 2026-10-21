import { NextResponse } from "next/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { auth } from "@/lib/auth";
import { getProviderApiKey } from "@/lib/ai/providers";
import { db } from "@/lib/db";
import { contentExportEvents, contentTextSnapshots, documents } from "@/lib/db/schema";
import { CATEGORIES, evaluatePair, RUBRIC_VERSION } from "../../../../../../scripts/first-pass-eval-lib.cjs";

const MAX_CALLS = 24;
const MODEL_ID = "gemini-2.5-flash";

type Label = { material: boolean; category: string | null; rationale: string; reviewed: false };
type StoredLabels = { rubricVersion: string; pairId: string; modelId: string; labels: Record<string, Label> };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const requestedExportId = new URL(req.url).searchParams.get("exportId");
  try {
    const latest = requestedExportId ? null : await db.query.contentExportEvents.findFirst({
      where: eq(contentExportEvents.documentId, id),
      orderBy: [desc(contentExportEvents.createdAt), desc(contentExportEvents.id)],
    });
    const exportId = requestedExportId ?? latest?.exportId ?? null;
    if (!exportId) {
      return NextResponse.json({ rubricVersion: RUBRIC_VERSION, exportId: null, matched: 0, excluded: [], episodes: [] });
    }
    const events = await db.query.contentExportEvents.findMany({
      where: and(eq(contentExportEvents.documentId, id), eq(contentExportEvents.exportId, exportId)),
      orderBy: [asc(contentExportEvents.episodeNumber), asc(contentExportEvents.createdAt)],
    });
    const selected = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      const key = String(event.episodeNumber ?? event.sectionUid ?? event.id);
      const previous = selected.get(key);
      if (!previous || previous.createdAt < event.createdAt) selected.set(key, event);
    }
    const episodes = [];
    const excluded: Array<{ episode: number | null; reason: string }> = [];
    const judgingErrors: Array<{ episode: number; reason: string }> = [];
    let calls = 0;
    let model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>> | null = null;
    for (const event of selected.values()) {
      const final = event.snapshotId ? await db.query.contentTextSnapshots.findFirst({
        where: and(eq(contentTextSnapshots.documentId, id), eq(contentTextSnapshots.id, event.snapshotId)),
      }) : null;
      const exactFirst = event.generationRunId && event.episodeNumber !== null
        ? await db.query.contentTextSnapshots.findFirst({
          where: and(
            eq(contentTextSnapshots.documentId, id),
            eq(contentTextSnapshots.generationRunId, event.generationRunId),
            eq(contentTextSnapshots.snapshotKind, "first_generation"),
            eq(contentTextSnapshots.episodeNumber, event.episodeNumber),
          ),
          orderBy: [asc(contentTextSnapshots.createdAt), asc(contentTextSnapshots.id)],
        }) : null;
      const first = exactFirst ?? (event.generationRunId ? await db.query.contentTextSnapshots.findFirst({
        where: and(
          eq(contentTextSnapshots.documentId, id),
          eq(contentTextSnapshots.generationRunId, event.generationRunId),
          eq(contentTextSnapshots.snapshotKind, "first_generation"),
          isNull(contentTextSnapshots.episodeNumber),
        ),
        orderBy: [asc(contentTextSnapshots.createdAt), asc(contentTextSnapshots.id)],
      }) : null);
      let reason: string | null = null;
      if (event.episodeNumber === null) reason = "missing_episode_number";
      else if (!final || final.snapshotKind !== "final_export") reason = "missing_final_export_snapshot";
      else if (final.textHash !== event.textHash) reason = "export_final_hash_mismatch";
      else if (final.episodeNumber !== null && final.episodeNumber !== event.episodeNumber) reason = "final_episode_mismatch";
      else if (/content_similarity/i.test(`${event.matchReason ?? ""} ${final.matchReason ?? ""}`)) reason = "similarity_pair_needs_review";
      else if (!first) reason = "missing_exact_first_generation";
      else if (first.episodeNumber !== null && first.episodeNumber !== event.episodeNumber) reason = "first_episode_mismatch";
      else if (first.generationRunId !== event.generationRunId) reason = "run_mismatch";
      else if (first.createdAt > event.createdAt) reason = "first_after_export";
      if (reason) {
        excluded.push({ episode: event.episodeNumber, reason });
        continue;
      }
      const pair = {
        documentId: id,
        episode: event.episodeNumber!,
        exportId,
        firstId: first!.id,
        finalId: final!.id,
        generationRunId: event.generationRunId,
        firstText: first!.textRaw,
        finalText: final!.textRaw,
      };
      const baseline = evaluatePair(pair);
      const metadata = JSON.parse(final!.metadataJson || "{}");
      const stored = metadata.firstPassEval as StoredLabels | undefined;
      const labels: Record<string, Label> = stored?.rubricVersion === RUBRIC_VERSION && stored.pairId === baseline.pairId
        ? { ...stored.labels } : {};
      const unlabelled = baseline.changes.filter((change) => change.operation !== "unchanged" && !labels[change.id]);
      if (unlabelled.length && calls < MAX_CALLS) {
        try {
          if (!model) {
            const apiKey = await getProviderApiKey("google");
            if (!apiKey) throw new Error("google_ai_provider_not_configured");
            model = createGoogleGenerativeAI({ apiKey })(MODEL_ID);
          }
          for (let start = 0; start < unlabelled.length && calls < MAX_CALLS; start += 12) {
            const chunk = unlabelled.slice(start, start + 12);
            if (chunk.some((change) => change.firstText.length + change.finalText.length > 8000)) {
              judgingErrors.push({ episode: event.episodeNumber!, reason: "long_change_needs_review" });
              continue;
            }
            const response = await generateText({
              model,
              system: `Classify revisions from AI first draft to accepted final. Return only a JSON array with one object per supplied id: {id,material,category,rationale}. material=false for cosmetic edits. For material=true, use exactly one primary category from ${CATEGORIES.join(", ")}. Story facts/continuity=story_truth; beat order/pacing=episode_shape; character motive/emotion=character_emotion; spoken wording/voice=dialogue_vo; visible action/staging=visual_storytelling; production format=script_form; otherwise=other. The final is the reference. Do not judge its quality.`,
              prompt: JSON.stringify(chunk.map((change) => ({ id: change.id, first: change.firstText, final: change.finalText }))),
              temperature: 0,
            });
            calls++;
            const parsed: unknown = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
            if (!Array.isArray(parsed) || parsed.length !== chunk.length) throw new Error("invalid_label_count");
            const byId = new Map(parsed.map((item: { id?: string }) => [item.id, item]));
            for (const change of chunk) {
              const item = byId.get(change.id) as { material?: unknown; category?: unknown; rationale?: unknown } | undefined;
              if (!item || typeof item.material !== "boolean" || (item.material && !CATEGORIES.includes(item.category as string))) {
                throw new Error("invalid_label_response");
              }
              labels[change.id] = {
                material: item.material,
                category: item.material ? item.category as string : null,
                rationale: String(item.rationale ?? "").slice(0, 300),
                reviewed: false,
              };
            }
          }
        } catch (error) {
          console.error("First-pass AI labelling failed", { episode: event.episodeNumber, error });
          judgingErrors.push({ episode: event.episodeNumber!, reason: error instanceof Error && error.message === "google_ai_provider_not_configured" ? "google_ai_provider_not_configured" : "ai_labelling_failed" });
        }
        if (Object.keys(labels).length > 0) {
          await db.update(contentTextSnapshots).set({
            metadataJson: JSON.stringify({ ...metadata, firstPassEval: { rubricVersion: RUBRIC_VERSION, pairId: baseline.pairId, modelId: MODEL_ID, labels } }),
          }).where(eq(contentTextSnapshots.id, final!.id));
        }
      }
      const result = evaluatePair(pair, labels);
      episodes.push({
        episode: result.episode,
        firstSnapshotId: result.firstId,
        finalSnapshotId: result.finalId,
        fitScore: result.fitScore,
        scoreStatus: result.scoreStatus,
        wordEditRate: result.wordEditRate,
        changedGroups: result.changedGroups,
        pendingGroups: result.pendingGroups,
        firstWords: result.firstWords,
        finalWords: result.finalWords,
        categoryPointsLost: result.deductionsPct,
      });
    }
    return NextResponse.json({ rubricVersion: RUBRIC_VERSION, exportId, matched: episodes.length, excluded, judgingErrors, aiModel: MODEL_ID, aiCalls: calls, episodes });
  } catch (error) {
    console.error("First-pass report failed", error);
    return NextResponse.json({ error: "First-pass report failed" }, { status: 500 });
  }
}
