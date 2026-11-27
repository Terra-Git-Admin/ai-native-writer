import { streamText } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  aiJobs,
  documentVersions,
  documents,
  predefinedBulkRunItems,
  predefinedBulkRuns,
  prompts,
  tabs,
} from "@/lib/db/schema";
import { getAIModel } from "@/lib/ai/providers";
import {
  PREDEFINED_LAB_BEATS_PROMPT,
  PREDEFINED_LAB_DIALOGUE_DESIGN_PROMPT,
  PREDEFINED_LAB_DRAFT_PROMPT,
} from "@/lib/ai/prompts";
import {
  getActivePredefinedLabDialogueGuide,
  getActivePredefinedLabDialogueReferencePack,
} from "@/lib/ai/predefined-lab-dialogue-guide";
import {
  DEFAULT_DIALOGUE_DESIGN_INSTRUCTION,
  buildPredefinedLabContext,
  buildPredefinedPromptBoxValue,
  type PredefinedLabMode,
} from "@/lib/ai/predefined-lab-runtime";
import { composePromptForOrientation } from "@/lib/ai/content-profile";
import { parseDocumentOrientation } from "@/lib/document-orientation";
import {
  capturePredefinedTiptapSnapshots,
  captureTextSnapshot,
  createOrReuseGenerationRun,
} from "@/lib/lineage/content-lineage";
import { logEvent, warnTrace } from "@/lib/saveTrace";
import { buildBulkPreview, parseEpisodeSections, type BulkPreview } from "@/lib/predefined-bulk/catalog";

type BulkRun = typeof predefinedBulkRuns.$inferSelect;
type BulkItem = typeof predefinedBulkRunItems.$inferSelect;

const FALLBACK_PROMPTS: Record<Extract<PredefinedLabMode, "predef_lab_beats" | "predef_lab_dialogue_design" | "predef_lab_draft">, string> = {
  predef_lab_beats: PREDEFINED_LAB_BEATS_PROMPT,
  predef_lab_dialogue_design: PREDEFINED_LAB_DIALOGUE_DESIGN_PROMPT,
  predef_lab_draft: PREDEFINED_LAB_DRAFT_PROMPT,
};

const workersGlobal = globalThis as unknown as {
  __predefinedBulkWorkers?: Map<string, AbortController>;
};
const activeWorkers = (workersGlobal.__predefinedBulkWorkers ??= new Map());

export class PredefinedBulkError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "PredefinedBulkError";
  }
}

async function loadDocumentTabs(documentId: string) {
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  if (!doc) throw new PredefinedBulkError("DOCUMENT_NOT_FOUND", "Document not found.", 404);
  const rows = await db.query.tabs.findMany({ where: eq(tabs.documentId, documentId) });
  const plotTab = rows.find((tab) => tab.type === "microdrama_plots");
  const predefinedTab = rows.find((tab) => tab.type === "predefined_episodes");
  if (!plotTab || !predefinedTab) {
    throw new PredefinedBulkError("CANONICAL_TAB_MISSING", "Microdrama Plots or Predefined Episodes is unavailable.", 409);
  }
  return { doc, plotTab, predefinedTab };
}

export async function getPredefinedBulkPreview(documentId: string): Promise<{
  preview: BulkPreview;
  plotTabId: string;
  predefinedTabId: string;
}> {
  const { plotTab, predefinedTab } = await loadDocumentTabs(documentId);
  return {
    preview: buildBulkPreview(plotTab.content, predefinedTab.content),
    plotTabId: plotTab.id,
    predefinedTabId: predefinedTab.id,
  };
}

function publicRun(run: BulkRun, items: BulkItem[]) {
  return {
    id: run.id,
    documentId: run.documentId,
    status: run.status,
    modelId: run.modelId,
    totalItems: run.totalItems,
    completedItems: run.completedItems,
    skippedItems: run.skippedItems,
    currentEpisode: run.currentEpisode,
    failureReason: run.failureReason,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
    items: items.map((item) => ({
      id: item.id,
      episodeNumber: item.episodeNumber,
      episodeTitle: item.episodeTitle,
      positionIndex: item.positionIndex,
      status: item.status,
      currentStage: item.currentStage,
      attemptCount: item.attemptCount,
      failureReason: item.failureReason,
      savedSectionUid: item.savedSectionUid,
      completedAt: item.completedAt,
    })),
  };
}

export async function getPredefinedBulkRun(documentId: string, runId: string) {
  const run = await db.query.predefinedBulkRuns.findFirst({
    where: and(eq(predefinedBulkRuns.id, runId), eq(predefinedBulkRuns.documentId, documentId)),
  });
  if (!run) throw new PredefinedBulkError("RUN_NOT_FOUND", "Bulk run not found.", 404);
  const items = await db.query.predefinedBulkRunItems.findMany({
    where: eq(predefinedBulkRunItems.runId, run.id),
    orderBy: [asc(predefinedBulkRunItems.positionIndex)],
  });
  return publicRun(run, items);
}

export async function getLatestPredefinedBulkRun(documentId: string) {
  const run = await db.query.predefinedBulkRuns.findFirst({
    where: eq(predefinedBulkRuns.documentId, documentId),
    orderBy: [desc(predefinedBulkRuns.createdAt)],
  });
  return run ? getPredefinedBulkRun(documentId, run.id) : null;
}

export async function createPredefinedBulkRun(input: {
  documentId: string;
  userId: string;
  modelId: string;
  thinking: boolean;
  planHash: string;
}) {
  const { doc, plotTab, predefinedTab } = await loadDocumentTabs(input.documentId);
  if (doc.ownerId !== input.userId) throw new PredefinedBulkError("FORBIDDEN", "Forbidden.", 403);
  const preview = buildBulkPreview(plotTab.content, predefinedTab.content);
  if (preview.planHash !== input.planHash) {
    throw new PredefinedBulkError("PREVIEW_STALE", "Plots or predefined episodes changed. Review the updated bulk plan.", 409);
  }
  if (preview.issues.length) throw new PredefinedBulkError("INVALID_SOURCE", preview.issues.join(" "), 422);
  if (!preview.eligible.length) throw new PredefinedBulkError("NOTHING_TO_GENERATE", "All written plots already have predefined episodes.", 409);

  const [activeRun, activeJob] = await Promise.all([
    db.query.predefinedBulkRuns.findFirst({
      where: and(
        eq(predefinedBulkRuns.documentId, input.documentId),
        inArray(predefinedBulkRuns.status, ["pending", "running", "paused"])
      ),
    }),
    db.query.aiJobs.findFirst({
      where: and(eq(aiJobs.documentId, input.documentId), inArray(aiJobs.status, ["pending", "running"])),
    }),
  ]);
  if (activeRun) throw new PredefinedBulkError("RUN_ACTIVE", "A bulk run is already active for this document.", 409);
  if (activeJob) throw new PredefinedBulkError("AI_BUSY", "Another document generation is already running.", 409);

  const runId = `pbulk_${nanoid(12)}`;
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(predefinedBulkRuns).values({
      id: runId,
      documentId: input.documentId,
      plotTabId: plotTab.id,
      predefinedTabId: predefinedTab.id,
      status: "pending",
      modelId: input.modelId,
      thinking: input.thinking,
      planHash: preview.planHash,
      totalItems: preview.eligible.length,
      completedItems: 0,
      skippedItems: 0,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    }).run();
    tx.insert(predefinedBulkRunItems).values(
      preview.eligible.map((episode, index) => ({
        id: `pbi_${nanoid(12)}`,
        runId,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.title,
        positionIndex: index,
        plotSectionUid: episode.sectionUid,
        plotText: episode.content,
        plotHash: episode.hash,
        promptText: buildPredefinedPromptBoxValue(episode, parseDocumentOrientation(doc.orientation)),
        status: "pending" as const,
        currentStage: "pending" as const,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      }))
    ).run();
  });
  startPredefinedBulkRun(runId);
  return getPredefinedBulkRun(input.documentId, runId);
}

async function resolveSystemPrompt(mode: "predef_lab_beats" | "predef_lab_dialogue_design" | "predef_lab_draft", orientation: ReturnType<typeof parseDocumentOrientation>) {
  const stored = await db.query.prompts.findFirst({ where: eq(prompts.id, mode) });
  const base = composePromptForOrientation(stored?.content || FALLBACK_PROMPTS[mode], mode, orientation);
  if (mode === "predef_lab_dialogue_design") return base;
  if (mode === "predef_lab_draft") {
    return `${base}\n\n## Final-Export Performance Guide\n${await getActivePredefinedLabDialogueGuide()}`;
  }
  return base;
}

async function generateStage(input: {
  mode: "predef_lab_beats" | "predef_lab_dialogue_design" | "predef_lab_draft";
  modelId: string;
  orientation: ReturnType<typeof parseDocumentOrientation>;
  context: string;
  signal: AbortSignal;
}): Promise<string> {
  let context = input.context;
  if (input.mode === "predef_lab_dialogue_design") {
    const supplemental = `## Dialogue Quality Guide\n${await getActivePredefinedLabDialogueGuide()}\n\n## Dialogue Reference Pack\n${await getActivePredefinedLabDialogueReferencePack()}`;
    context = context.includes("## Approved / Current Key Beats")
      ? context.replace("## Approved / Current Key Beats", `${supplemental}\n\n## Approved / Current Key Beats`)
      : `${context}\n\n${supplemental}`;
  }
  const modelId = input.mode === "predef_lab_dialogue_design" ? "gemini-3.1-pro-preview" : input.modelId;
  let streamError: unknown = null;
  const result = streamText({
    model: await getAIModel(modelId, true),
    system: await resolveSystemPrompt(input.mode, input.orientation),
    messages: [{ role: "user", content: context }],
    abortSignal: input.signal,
    providerOptions: {
      anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
      google: { thinkingConfig: { thinkingBudget: 10000 } },
    },
    onError: ({ error }) => {
      streamError = error;
    },
  });
  let output = "";
  try {
    for await (const chunk of result.textStream) output += chunk;
  } catch (error) {
    if (input.signal.aborted) throw error;
    streamError = error;
  }
  if (streamError) {
    const message = streamError instanceof Error ? streamError.message : String(streamError);
    if (/API key not valid|API_KEY_INVALID/i.test(message)) {
      const provider = modelId.startsWith("gemini-") ? "Gemini" : "AI provider";
      throw new Error(`${provider} API key is invalid. Update it in Admin Settings, then retry this episode.`);
    }
    throw new Error(`Model request failed: ${message.slice(0, 300)}`);
  }
  if (!output.trim()) throw new Error("No output returned from the model.");
  return output.trim();
}

function validateDraft(draft: string): string | null {
  if (draft.trim().length < 400) return "The generated draft was incomplete.";
  if (!/^\s*Episode\s+\d+\b/im.test(draft)) return "The generated draft did not identify its episode.";
  if (!/^\s*Seq\s+\d+\s*[—–-]/im.test(draft)) return "The generated draft did not contain a sequence.";
  if (!/^\s*\(Visual:/im.test(draft)) return "The generated draft did not contain a visual beat.";
  if (/^\s*\[(H\d|P|UL|OL)\]/m.test(draft)) return "The generated draft used import tags instead of the Lab format.";
  return null;
}

function appendDraftToTiptap(input: {
  contentJson: string | null;
  title: string;
  draft: string;
  sectionUid: string;
  spineId: string | null;
  generationRunId: string;
}): string {
  let doc: { type: "doc"; content: Array<Record<string, unknown>> };
  try {
    const parsed = JSON.parse(input.contentJson ?? "") as typeof doc;
    doc = parsed?.type === "doc" && Array.isArray(parsed.content) ? parsed : { type: "doc", content: [] };
  } catch {
    doc = { type: "doc", content: [] };
  }
  const bodyLines = input.draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (/^Episode\s+\d+\b/i.test(bodyLines[0] ?? "")) bodyLines.shift();
  doc.content.push({
    type: "heading",
    attrs: {
      level: 3,
      anwSectionUid: input.sectionUid,
      anwSpineId: input.spineId,
      anwGenerationRunId: input.generationRunId,
    },
    content: [{ type: "text", text: input.title }],
  });
  for (const line of bodyLines) {
    doc.content.push({ type: "paragraph", content: [{ type: "text", text: line }] });
  }
  return JSON.stringify(doc);
}

async function checkpointVersion(documentId: string, tabId: string, content: string, userId: string) {
  const latest = await db.query.documentVersions.findFirst({
    where: and(eq(documentVersions.documentId, documentId), eq(documentVersions.tabId, tabId)),
    orderBy: [desc(documentVersions.createdAt)],
  });
  if (latest?.content === content) return;
  await db.insert(documentVersions).values({
    id: nanoid(12), documentId, tabId, content, createdBy: userId, createdAt: new Date(),
  });
  const rows = await db.query.documentVersions.findMany({
    where: and(eq(documentVersions.documentId, documentId), eq(documentVersions.tabId, tabId)),
    orderBy: [desc(documentVersions.createdAt)],
  });
  if (rows.length > 10) {
    const keep = new Set(rows.slice(0, 10).map((row) => row.id));
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const nowIst = Date.now() + istOffsetMs;
    const startOfTodayIst = new Date(Math.floor(nowIst / 86_400_000) * 86_400_000 - istOffsetMs);
    const dailyAnchor = rows.find((row) => row.createdAt < startOfTodayIst);
    if (dailyAnchor) keep.add(dailyAnchor.id);
    const toDelete = rows.filter((row) => !keep.has(row.id)).map((row) => row.id);
    if (toDelete.length > 0) {
      await db.delete(documentVersions).where(inArray(documentVersions.id, toDelete));
    }
  }
}

async function saveItem(run: BulkRun, item: BulkItem): Promise<"saved" | "skipped"> {
  const target = await db.query.tabs.findFirst({ where: eq(tabs.id, run.predefinedTabId) });
  if (!target) throw new Error("Predefined Episodes tab is unavailable.");
  if (parseEpisodeSections(target.content).some((episode) => episode.episodeNumber === item.episodeNumber)) {
    return "skipped";
  }
  const draft = item.draftOutput ?? "";
  const validation = validateDraft(draft);
  if (validation) throw new Error(validation);
  const generated = await createOrReuseGenerationRun({
    documentId: run.documentId,
    createdBy: run.createdBy,
    labRunId: item.id,
    targetPlotText: item.plotText,
    targetPlotSectionUid: item.plotSectionUid,
    targetEpisodeNumber: item.episodeNumber,
    targetTitle: item.episodeTitle,
    selectedContext: { source: "predefined_bulk", runId: run.id, previousEpisodePolicy: "all_earlier" },
    writerInstruction: item.promptText,
    modelId: run.modelId,
    promptMode: "predef_lab_draft",
  });
  await captureTextSnapshot({
    documentId: run.documentId,
    tabId: run.predefinedTabId,
    artifactType: "predefined_episode",
    sourceSurface: "predefined_lab",
    snapshotKind: "first_generation",
    textRaw: draft,
    episodeNumber: item.episodeNumber,
    episodeTitle: item.episodeTitle,
    labRunId: generated.generationRunId,
    labTurnId: `${item.id}:draft`,
    generationRunId: generated.generationRunId,
    spineId: generated.spineId,
    spineRevisionId: generated.spineRevisionId,
    matchConfidence: "high",
    matchReason: "predefined_bulk_generation",
    createdBy: run.createdBy,
    metadata: { bulkRunId: run.id, bulkItemId: item.id },
  });
  const sectionUid = `anwsec_${nanoid(12)}`;
  const content = appendDraftToTiptap({
    contentJson: target.content,
    title: item.episodeTitle,
    draft,
    sectionUid,
    spineId: generated.spineId,
    generationRunId: generated.generationRunId,
  });
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db.update(tabs).set({ content, updatedAt: now }).where(eq(tabs.id, target.id));
  await db.update(documents).set({ updatedAt: now }).where(eq(documents.id, run.documentId));
  await checkpointVersion(run.documentId, target.id, content, run.createdBy);
  await capturePredefinedTiptapSnapshots({
    documentId: run.documentId,
    tabId: target.id,
    contentJson: content,
    sourceSurface: "predefined_tab",
    snapshotKind: "final_saved",
    createdBy: run.createdBy,
  });
  await db.update(predefinedBulkRunItems).set({
    generationRunId: generated.generationRunId,
    savedSectionUid: sectionUid,
    updatedAt: new Date(),
  }).where(eq(predefinedBulkRunItems.id, item.id));
  return "saved";
}

async function processItem(run: BulkRun, item: BulkItem, signal: AbortSignal) {
  const plotTab = await db.query.tabs.findFirst({ where: eq(tabs.id, run.plotTabId) });
  const livePlot = parseEpisodeSections(plotTab?.content ?? null).find((episode) => episode.episodeNumber === item.episodeNumber);
  if (!livePlot || livePlot.hash !== item.plotHash) {
    throw new PredefinedBulkError("SOURCE_CHANGED", `Episode ${item.episodeNumber} plot changed after this run was confirmed.`, 409);
  }
  const target = await db.query.tabs.findFirst({ where: eq(tabs.id, run.predefinedTabId) });
  const previous = parseEpisodeSections(target?.content ?? null)
    .filter((episode) => episode.episodeNumber < item.episodeNumber)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, run.documentId) });
  const orientation = parseDocumentOrientation(doc?.orientation);
  await db.update(predefinedBulkRunItems).set({
    status: "running", attemptCount: item.attemptCount + 1, failureReason: null, updatedAt: new Date(),
  }).where(eq(predefinedBulkRunItems.id, item.id));

  let beats = item.beatsOutput ?? "";
  let dialogue = item.dialogueOutput ?? "";
  let draft = item.draftOutput ?? "";
  if (!beats) {
    await db.update(predefinedBulkRunItems).set({ currentStage: "beats", updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
    beats = await generateStage({
      mode: "predef_lab_beats", modelId: run.modelId, orientation, signal,
      context: buildPredefinedLabContext({
        mode: "predef_lab_beats", selectedPredefs: previous, promptText: item.promptText,
        turnInstruction: "Build key beats from the editable prompt source.", beatPlan: "", dialogueDesign: "", draft: "",
      }),
    });
    await db.update(predefinedBulkRunItems).set({ beatsOutput: beats, updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
  }
  if (!dialogue) {
    await db.update(predefinedBulkRunItems).set({ currentStage: "dialogue", updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
    dialogue = await generateStage({
      mode: "predef_lab_dialogue_design", modelId: run.modelId, orientation, signal,
      context: buildPredefinedLabContext({
        mode: "predef_lab_dialogue_design", selectedPredefs: previous, promptText: item.promptText,
        turnInstruction: DEFAULT_DIALOGUE_DESIGN_INSTRUCTION, beatPlan: beats, dialogueDesign: "", draft: "",
      }),
    });
    await db.update(predefinedBulkRunItems).set({ dialogueOutput: dialogue, updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
  }
  if (!draft) {
    await db.update(predefinedBulkRunItems).set({ currentStage: "draft", updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
    draft = await generateStage({
      mode: "predef_lab_draft", modelId: run.modelId, orientation, signal,
      context: buildPredefinedLabContext({
        mode: "predef_lab_draft", selectedPredefs: previous, promptText: item.promptText,
        turnInstruction: "Write episode draft from finalized key beats and approved dialogue design.", beatPlan: beats, dialogueDesign: dialogue, draft: "",
      }),
    });
    await db.update(predefinedBulkRunItems).set({ draftOutput: draft, updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
  }
  const refreshed = await db.query.predefinedBulkRunItems.findFirst({ where: eq(predefinedBulkRunItems.id, item.id) });
  if (!refreshed) throw new Error("Bulk run item disappeared.");
  await db.update(predefinedBulkRunItems).set({ currentStage: "save", updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
  const result = await saveItem(run, { ...refreshed, beatsOutput: beats, dialogueOutput: dialogue, draftOutput: draft });
  const completedAt = new Date();
  await db.update(predefinedBulkRunItems).set({
    status: result === "saved" ? "completed" : "skipped",
    currentStage: "complete",
    failureReason: null,
    completedAt,
    updatedAt: completedAt,
  }).where(eq(predefinedBulkRunItems.id, item.id));
}

async function runWorker(runId: string, controller: AbortController) {
  let run = await db.query.predefinedBulkRuns.findFirst({ where: eq(predefinedBulkRuns.id, runId) });
  if (!run || !["pending", "running"].includes(run.status)) return;
  await db.update(predefinedBulkRuns).set({
    status: "running", startedAt: run.startedAt ?? new Date(), failureReason: null, updatedAt: new Date(),
  }).where(eq(predefinedBulkRuns.id, runId));
  run = { ...run, status: "running", startedAt: run.startedAt ?? new Date() };
  const items = await db.query.predefinedBulkRunItems.findMany({
    where: eq(predefinedBulkRunItems.runId, runId), orderBy: [asc(predefinedBulkRunItems.positionIndex)],
  });
  for (const item of items) {
    if (controller.signal.aborted) return;
    if (["completed", "skipped", "cancelled"].includes(item.status)) continue;
    await db.update(predefinedBulkRuns).set({ currentEpisode: item.episodeNumber, updatedAt: new Date() }).where(eq(predefinedBulkRuns.id, runId));
    try {
      await processItem(run, item, controller.signal);
    } catch (error) {
      const liveRun = await db.query.predefinedBulkRuns.findFirst({ where: eq(predefinedBulkRuns.id, runId) });
      if (controller.signal.aborted || liveRun?.status === "cancelled") return;
      const reason = error instanceof Error ? error.message : "Bulk generation failed.";
      await db.update(predefinedBulkRunItems).set({ status: "failed", failureReason: reason, updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, item.id));
      await db.update(predefinedBulkRuns).set({ status: "paused", failureReason: reason, updatedAt: new Date() }).where(eq(predefinedBulkRuns.id, runId));
      warnTrace("predefined_bulk.paused", { runId, episodeNumber: item.episodeNumber, reason });
      return;
    }
    const finished = await db.query.predefinedBulkRunItems.findMany({ where: eq(predefinedBulkRunItems.runId, runId) });
    await db.update(predefinedBulkRuns).set({
      completedItems: finished.filter((entry) => entry.status === "completed").length,
      skippedItems: finished.filter((entry) => entry.status === "skipped").length,
      updatedAt: new Date(),
    }).where(eq(predefinedBulkRuns.id, runId));
  }
  const completedAt = new Date();
  await db.update(predefinedBulkRuns).set({
    status: "completed", currentEpisode: null, failureReason: null, completedAt, updatedAt: completedAt,
  }).where(eq(predefinedBulkRuns.id, runId));
  logEvent("predefined_bulk.completed", { runId, documentId: run.documentId, totalItems: run.totalItems });
}

export function startPredefinedBulkRun(runId: string) {
  if (activeWorkers.has(runId)) return;
  const controller = new AbortController();
  activeWorkers.set(runId, controller);
  void runWorker(runId, controller).finally(() => activeWorkers.delete(runId));
}

export async function retryPredefinedBulkRun(documentId: string, runId: string, userId: string) {
  const run = await db.query.predefinedBulkRuns.findFirst({
    where: and(eq(predefinedBulkRuns.id, runId), eq(predefinedBulkRuns.documentId, documentId)),
  });
  if (!run) throw new PredefinedBulkError("RUN_NOT_FOUND", "Bulk run not found.", 404);
  if (run.createdBy !== userId) throw new PredefinedBulkError("FORBIDDEN", "Forbidden.", 403);
  if (run.status !== "paused") throw new PredefinedBulkError("RUN_NOT_PAUSED", "Only a paused run can be resumed.", 409);
  const failed = await db.query.predefinedBulkRunItems.findFirst({
    where: and(eq(predefinedBulkRunItems.runId, runId), eq(predefinedBulkRunItems.status, "failed")),
    orderBy: [asc(predefinedBulkRunItems.positionIndex)],
  });
  if (failed) {
    await db.update(predefinedBulkRunItems).set({ status: "pending", failureReason: null, updatedAt: new Date() }).where(eq(predefinedBulkRunItems.id, failed.id));
  }
  await db.update(predefinedBulkRuns).set({ status: "pending", failureReason: null, updatedAt: new Date() }).where(eq(predefinedBulkRuns.id, runId));
  startPredefinedBulkRun(runId);
  return getPredefinedBulkRun(documentId, runId);
}

export async function cancelPredefinedBulkRun(documentId: string, runId: string, userId: string) {
  const run = await db.query.predefinedBulkRuns.findFirst({
    where: and(eq(predefinedBulkRuns.id, runId), eq(predefinedBulkRuns.documentId, documentId)),
  });
  if (!run) throw new PredefinedBulkError("RUN_NOT_FOUND", "Bulk run not found.", 404);
  if (run.createdBy !== userId) throw new PredefinedBulkError("FORBIDDEN", "Forbidden.", 403);
  if (["completed", "cancelled"].includes(run.status)) return getPredefinedBulkRun(documentId, runId);
  activeWorkers.get(runId)?.abort();
  const now = new Date();
  await db.update(predefinedBulkRunItems).set({ status: "cancelled", completedAt: now, updatedAt: now }).where(
    and(eq(predefinedBulkRunItems.runId, runId), inArray(predefinedBulkRunItems.status, ["pending", "running", "failed"]))
  );
  await db.update(predefinedBulkRuns).set({ status: "cancelled", currentEpisode: null, completedAt: now, updatedAt: now }).where(eq(predefinedBulkRuns.id, runId));
  return getPredefinedBulkRun(documentId, runId);
}

export async function recoverInterruptedPredefinedBulkRuns(): Promise<number> {
  const interrupted = await db.query.predefinedBulkRuns.findMany({
    where: inArray(predefinedBulkRuns.status, ["pending", "running"]),
  });
  if (!interrupted.length) return 0;
  const ids = interrupted.map((run) => run.id);
  const now = new Date();
  await db.update(predefinedBulkRunItems).set({
    status: "failed", failureReason: "The app restarted during this stage. Resume to retry it.", updatedAt: now,
  }).where(and(inArray(predefinedBulkRunItems.runId, ids), eq(predefinedBulkRunItems.status, "running")));
  await db.update(predefinedBulkRuns).set({
    status: "paused", failureReason: "The app restarted. Completed episodes are safe; resume to continue.", updatedAt: now,
  }).where(inArray(predefinedBulkRuns.id, ids));
  return interrupted.length;
}
