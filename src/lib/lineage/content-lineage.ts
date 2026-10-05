import { and, desc, eq, notInArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  contentExportEvents,
  contentLineages,
  contentTextSnapshots,
  generationRuns,
  storySpineRevisions,
  storySpines,
} from "@/lib/db/schema";
import { contentHash, logEvent } from "@/lib/saveTrace";
import { parseEpisodeHeading } from "@/lib/export/tiptap-parser";

export type ArtifactType = "predefined_episode" | "plot_lab_plot";
export type SourceSurface = "predefined_lab" | "predefined_tab" | "handoff_export" | "plot_lab";
export type SnapshotKind =
  | "first_generation"
  | "final_saved"
  | "final_export"
  | "interim_generation"
  | "tombstone";
export type MatchConfidence = "high" | "medium" | "low" | "none";

interface TiptapNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

interface ParsedDoc extends TiptapNode {
  type: "doc";
  content?: TiptapNode[];
}

interface ExtractedSection {
  episodeNumber: number | null;
  episodeTitle: string;
  sectionUid: string | null;
  spineId: string | null;
  generationRunId: string | null;
  positionIndex: number;
  textRaw: string;
  metadata: Record<string, unknown>;
}

export interface TextSnapshotInput {
  documentId: string;
  tabId?: string | null;
  artifactType: ArtifactType;
  sourceSurface: SourceSurface;
  snapshotKind: SnapshotKind;
  createdBy: string;
  textRaw: string;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
  sectionUid?: string | null;
  spineId?: string | null;
  spineRevisionId?: string | null;
  generationRunId?: string | null;
  positionIndex?: number | null;
  matchConfidence?: MatchConfidence;
  matchReason?: string | null;
  sourceId?: string | null;
  labRunId?: string | null;
  labTurnId?: string | null;
  parentSnapshotId?: string | null;
  turnIndex?: number | null;
  metadata?: Record<string, unknown>;
}

export interface CaptureResult {
  lineageId: string;
  snapshotId: string | null;
  skipped: boolean;
  reason?: "empty" | "duplicate" | "first_generation_exists";
  textHash?: string;
  textLength?: number;
  sectionUid?: string | null;
  spineId?: string | null;
  spineRevisionId?: string | null;
  generationRunId?: string | null;
}

export interface LineageContentResult {
  contentJson: string | null;
  changed: boolean;
}

function readAttr(node: TiptapNode, key: string): string | null {
  const value = node.attrs?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function setAttr(node: TiptapNode, key: string, value: string | null): void {
  node.attrs = node.attrs ?? {};
  if (value) node.attrs[key] = value;
  else delete node.attrs[key];
}

function newSectionUid(): string {
  return `anwsec_${nanoid(12)}`;
}

function parseDoc(contentJson: string | null): ParsedDoc | null {
  if (!contentJson) return null;
  try {
    const parsed = JSON.parse(contentJson) as ParsedDoc;
    return parsed?.type === "doc" ? parsed : null;
  } catch {
    return null;
  }
}

function textOf(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!node.content) return "";
  return node.content.map(textOf).join("");
}

function taggedLine(node: TiptapNode): string | null {
  if (node.type === "heading") {
    const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
    const text = textOf(node).trim();
    return text ? `[H${level}] ${text}` : null;
  }
  if (node.type === "paragraph") {
    const text = textOf(node).trim();
    return text ? `[P] ${text}` : null;
  }
  if (node.type === "orderedList" || node.type === "bulletList") {
    const tag = node.type === "orderedList" ? "[OL]" : "[UL]";
    const lines: string[] = [];
    for (const item of node.content ?? []) {
      const text = textOf(item).trim();
      if (text) lines.push(`${tag} ${text}`);
    }
    return lines.join("\n") || null;
  }
  return null;
}

function stripStructuralTags(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\[(?:H[1-6]|P|UL|OL)\]\s*/, ""))
    .join("\n")
    .trim();
}

export function normalizeComparableText(text: string): string {
  return stripStructuralTags(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function countDialogueLines(text: string): number {
  return text
    .split("\n")
    .filter((line) => /\b[A-Z][A-Z0-9 .'\-()]*:\s*["“]/.test(line)).length;
}

function countVisualBeats(text: string): number {
  return text.split("\n").filter((line) => /\bVisual\s*:/i.test(line)).length;
}

function countVoiceoverLines(text: string): number {
  return text.split("\n").filter((line) => /\bV\.?O\.?\b/i.test(line)).length;
}

function buildMetadata(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dialogueLines: countDialogueLines(text),
    visualBeats: countVisualBeats(text),
    voiceoverLines: countVoiceoverLines(text),
    lineCount: text.split("\n").filter((line) => line.trim()).length,
    ...extra,
  };
}

function comparableBodyForMatch(text: string): string {
  const lines = normalizeComparableText(text).split("\n");
  if (/^episode\s+\d+\b/i.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n").trim();
}

function tokenSetForMatch(text: string): Set<string> {
  return new Set(
    comparableBodyForMatch(text)
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function diceSimilarity(a: string, b: string): number {
  const left = tokenSetForMatch(a);
  const right = tokenSetForMatch(b);
  if (left.size < 40 || right.size < 40) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return (2 * overlap) / (left.size + right.size);
}

function isEpisodeHeading(node: TiptapNode): boolean {
  if (node.type !== "heading") return false;
  const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
  if (level > 3) return false;
  return parseEpisodeHeading(textOf(node).trim()) != null;
}

export function ensureEpisodeSectionUids(contentJson: string | null): LineageContentResult {
  const doc = parseDoc(contentJson);
  if (!doc?.content) return { contentJson, changed: false };

  let changed = false;
  const seen = new Set<string>();
  for (const node of doc.content) {
    if (!isEpisodeHeading(node)) continue;
    const existing = readAttr(node, "anwSectionUid");
    if (!existing || seen.has(existing)) {
      const uid = newSectionUid();
      setAttr(node, "anwSectionUid", uid);
      seen.add(uid);
      changed = true;
    } else {
      seen.add(existing);
    }
  }

  return { contentJson: changed ? JSON.stringify(doc) : contentJson, changed };
}

function extractEpisodeSections(contentJson: string | null): ExtractedSection[] {
  const doc = parseDoc(contentJson);
  if (!doc?.content) return [];

  const sections: ExtractedSection[] = [];
  let current:
    | {
        heading: TiptapNode;
        episodeNumber: number | null;
        episodeTitle: string;
        lines: string[];
      }
    | null = null;

  const flush = () => {
    if (!current) return;
    const taggedText = current.lines.join("\n").trim();
    const textRaw = stripStructuralTags(taggedText);
    if (textRaw) {
      sections.push({
        episodeNumber: current.episodeNumber,
        episodeTitle: current.episodeTitle,
        sectionUid: readAttr(current.heading, "anwSectionUid"),
        spineId: readAttr(current.heading, "anwSpineId"),
        generationRunId: readAttr(current.heading, "anwGenerationRunId"),
        positionIndex: sections.length,
        textRaw,
        metadata: buildMetadata(textRaw, {
          parser: "tiptap_episode_sections",
          structuralTagsStripped: true,
          taggedTextLength: taggedText.length,
        }),
      });
    }
    current = null;
  };

  for (const node of doc.content) {
    if (node.type === "heading") {
      const parsed = parseEpisodeHeading(textOf(node).trim());
      if (parsed) {
        flush();
        current = {
          heading: node,
          episodeNumber: parsed.episodeNumber,
          episodeTitle: parsed.title,
          lines: [taggedLine(node) ?? ""],
        };
        continue;
      }
      flush();
      continue;
    }
    if (current) {
      const line = taggedLine(node);
      if (line) current.lines.push(line);
    }
  }
  flush();
  return sections;
}

async function latestSpineRevisionId(input: {
  spineId: string;
  textHash?: string;
}): Promise<string | null> {
  const where = input.textHash
    ? and(eq(storySpineRevisions.spineId, input.spineId), eq(storySpineRevisions.textHash, input.textHash))
    : eq(storySpineRevisions.spineId, input.spineId);
  const rows = await db
    .select({ id: storySpineRevisions.id })
    .from(storySpineRevisions)
    .where(where)
    .orderBy(desc(storySpineRevisions.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function findOrCreateSpine(input: {
  documentId: string;
  tabId?: string | null;
  sectionUid?: string | null;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
  positionIndex?: number | null;
}): Promise<string> {
  const now = new Date();
  if (input.sectionUid) {
    const existing = await db
      .select({ id: storySpines.id })
      .from(storySpines)
      .where(
        and(
          eq(storySpines.documentId, input.documentId),
          eq(storySpines.sourceSectionUid, input.sectionUid)
        )
      )
      .limit(1);
    if (existing[0]?.id) {
      await db
        .update(storySpines)
        .set({
          sourceTabId: input.tabId ?? null,
          currentEpisodeNumber: input.episodeNumber ?? null,
          currentTitle: input.episodeTitle ?? null,
          currentPositionIndex: input.positionIndex ?? null,
          status: "active",
          updatedAt: now,
          lastSeenAt: now,
        })
        .where(eq(storySpines.id, existing[0].id));
      return existing[0].id;
    }
  }

  const id = nanoid(12);
  await db.insert(storySpines).values({
    id,
    documentId: input.documentId,
    sourceTabId: input.tabId ?? null,
    sourceSectionUid: input.sectionUid ?? null,
    initialEpisodeNumber: input.episodeNumber ?? null,
    initialTitle: input.episodeTitle ?? null,
    currentEpisodeNumber: input.episodeNumber ?? null,
    currentTitle: input.episodeTitle ?? null,
    currentPositionIndex: input.positionIndex ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  });
  return id;
}

async function ensureSpineRevision(input: {
  spineId: string;
  documentId: string;
  tabId?: string | null;
  sectionUid?: string | null;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
  positionIndex?: number | null;
  textRaw: string;
  snapshotKind?: "plot_saved" | "plot_selected" | "plot_replaced" | "tombstone";
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const textComparable = normalizeComparableText(input.textRaw);
  const hash = contentHash(textComparable);
  const existing = await latestSpineRevisionId({ spineId: input.spineId, textHash: hash });
  if (existing) return existing;

  const id = nanoid(12);
  await db.insert(storySpineRevisions).values({
    id,
    spineId: input.spineId,
    documentId: input.documentId,
    tabId: input.tabId ?? null,
    sectionUid: input.sectionUid ?? null,
    episodeNumber: input.episodeNumber ?? null,
    episodeTitle: input.episodeTitle ?? null,
    positionIndex: input.positionIndex ?? null,
    textRaw: input.textRaw.trim(),
    textComparable,
    textHash: hash,
    textLength: input.textRaw.trim().length,
    snapshotKind: input.snapshotKind ?? "plot_saved",
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdBy: input.createdBy ?? null,
    createdAt: new Date(),
  });
  return id;
}

export async function captureMicrodramaPlotSpines(input: {
  documentId: string;
  tabId: string;
  contentJson: string | null;
  createdBy: string;
}): Promise<LineageContentResult & { sectionsSeen: number; revisionsCreatedOrMatched: number }> {
  const ensured = ensureEpisodeSectionUids(input.contentJson);
  const doc = parseDoc(ensured.contentJson);
  if (!doc?.content) return { ...ensured, sectionsSeen: 0, revisionsCreatedOrMatched: 0 };

  const seenSpines: string[] = [];
  let sectionsSeen = 0;
  let revisionsCreatedOrMatched = 0;
  let changed = ensured.changed;
  let currentHeading: TiptapNode | null = null;
  let currentLines: string[] = [];
  let currentNumber: number | null = null;
  let currentTitle = "";

  const flush = async () => {
    if (!currentHeading) return;
    const textRaw = stripStructuralTags(currentLines.join("\n"));
    if (!textRaw) return;
    const sectionUid = readAttr(currentHeading, "anwSectionUid");
    const positionIndex = sectionsSeen++;
    const spineId = await findOrCreateSpine({
      documentId: input.documentId,
      tabId: input.tabId,
      sectionUid,
      episodeNumber: currentNumber,
      episodeTitle: currentTitle,
      positionIndex,
    });
    if (readAttr(currentHeading, "anwSpineId") !== spineId) {
      setAttr(currentHeading, "anwSpineId", spineId);
      changed = true;
    }
    seenSpines.push(spineId);
    await ensureSpineRevision({
      spineId,
      documentId: input.documentId,
      tabId: input.tabId,
      sectionUid,
      episodeNumber: currentNumber,
      episodeTitle: currentTitle,
      positionIndex,
      textRaw,
      snapshotKind: "plot_saved",
      createdBy: input.createdBy,
      metadata: { source: "microdrama_plots_save" },
    });
    revisionsCreatedOrMatched += 1;
  };

  for (const node of doc.content) {
    if (node.type === "heading") {
      await flush();
      const parsed = parseEpisodeHeading(textOf(node).trim());
      if (parsed) {
        currentHeading = node;
        currentNumber = parsed.episodeNumber;
        currentTitle = parsed.title;
        currentLines = [taggedLine(node) ?? ""];
      } else {
        currentHeading = null;
        currentLines = [];
      }
      continue;
    }
    if (currentHeading) {
      const line = taggedLine(node);
      if (line) currentLines.push(line);
    }
  }
  await flush();

  if (seenSpines.length > 0) {
    await db
      .update(storySpines)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(
        and(
          eq(storySpines.documentId, input.documentId),
          eq(storySpines.sourceTabId, input.tabId),
          notInArray(storySpines.id, seenSpines)
        )
      );
  }

  return {
    contentJson: changed ? JSON.stringify(doc) : ensured.contentJson,
    changed,
    sectionsSeen,
    revisionsCreatedOrMatched,
  };
}

async function findOrCreateLineage(input: {
  documentId: string;
  tabId?: string | null;
  artifactType: ArtifactType;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
  sectionUid?: string | null;
  spineId?: string | null;
  generationRunId?: string | null;
}): Promise<string> {
  const now = new Date();
  const numberValue = input.episodeNumber ?? null;

  const candidates = [];
  if (input.generationRunId) {
    candidates.push(
      and(
        eq(contentLineages.documentId, input.documentId),
        eq(contentLineages.artifactType, input.artifactType),
        eq(contentLineages.generationRunId, input.generationRunId),
        eq(contentLineages.status, "active")
      )
    );
  }
  if (input.spineId) {
    candidates.push(
      and(
        eq(contentLineages.documentId, input.documentId),
        eq(contentLineages.artifactType, input.artifactType),
        eq(contentLineages.spineId, input.spineId),
        eq(contentLineages.status, "active")
      )
    );
  }
  if (input.sectionUid) {
    candidates.push(
      and(
        eq(contentLineages.documentId, input.documentId),
        eq(contentLineages.artifactType, input.artifactType),
        eq(contentLineages.sectionUid, input.sectionUid),
        eq(contentLineages.status, "active")
      )
    );
  }
  if (numberValue != null) {
    candidates.push(
      and(
        eq(contentLineages.documentId, input.documentId),
        eq(contentLineages.artifactType, input.artifactType),
        eq(contentLineages.currentNumber, numberValue),
        eq(contentLineages.status, "active")
      )
    );
  }

  for (const where of candidates) {
    if (!where) continue;
    const existing = await db
      .select({
        id: contentLineages.id,
        sectionUid: contentLineages.sectionUid,
        spineId: contentLineages.spineId,
        generationRunId: contentLineages.generationRunId,
      })
      .from(contentLineages)
      .where(where)
      .limit(1);
    if (existing[0]?.id) {
      await db
        .update(contentLineages)
        .set({
          tabId: input.tabId ?? null,
          currentNumber: numberValue,
          currentTitle: input.episodeTitle ?? null,
          sectionUid: input.sectionUid ?? existing[0].sectionUid ?? null,
          spineId: input.spineId ?? existing[0].spineId ?? null,
          generationRunId: input.generationRunId ?? existing[0].generationRunId ?? null,
          updatedAt: now,
          lastSeenAt: now,
        })
        .where(eq(contentLineages.id, existing[0].id));
      return existing[0].id;
    }
  }

  const id = nanoid(12);
  await db.insert(contentLineages).values({
    id,
    documentId: input.documentId,
    tabId: input.tabId ?? null,
    artifactType: input.artifactType,
    currentNumber: numberValue,
    currentTitle: input.episodeTitle ?? null,
    sectionUid: input.sectionUid ?? null,
    spineId: input.spineId ?? null,
    generationRunId: input.generationRunId ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  });
  return id;
}

export async function createOrReuseGenerationRun(input: {
  documentId: string;
  createdBy: string;
  labRunId?: string | null;
  targetPlotText?: string | null;
  targetPlotSectionUid?: string | null;
  targetEpisodeNumber?: number | null;
  targetTitle?: string | null;
  selectedContext?: unknown;
  writerInstruction?: string | null;
  modelId?: string | null;
  promptMode?: string | null;
}): Promise<{ generationRunId: string; spineId: string | null; spineRevisionId: string | null }> {
  const id = input.labRunId?.trim() || nanoid(12);
  const existing = await db.select({ id: generationRuns.id, spineId: generationRuns.spineId, spineRevisionId: generationRuns.spineRevisionId }).from(generationRuns).where(eq(generationRuns.id, id)).limit(1);
  if (existing[0]) {
    return {
      generationRunId: existing[0].id,
      spineId: existing[0].spineId ?? null,
      spineRevisionId: existing[0].spineRevisionId ?? null,
    };
  }

  let spineId: string | null = null;
  let spineRevisionId: string | null = null;
  if (input.targetPlotText?.trim()) {
    spineId = await findOrCreateSpine({
      documentId: input.documentId,
      sectionUid: input.targetPlotSectionUid ?? null,
      episodeNumber: input.targetEpisodeNumber ?? null,
      episodeTitle: input.targetTitle ?? null,
      positionIndex: null,
    });
    spineRevisionId = await ensureSpineRevision({
      spineId,
      documentId: input.documentId,
      sectionUid: input.targetPlotSectionUid ?? null,
      episodeNumber: input.targetEpisodeNumber ?? null,
      episodeTitle: input.targetTitle ?? null,
      textRaw: input.targetPlotText,
      snapshotKind: "plot_selected",
      createdBy: input.createdBy,
      metadata: { source: "predefined_lab_generation_run" },
    });
  }

  const instruction = input.writerInstruction?.trim() ?? "";
  await db.insert(generationRuns).values({
    id,
    documentId: input.documentId,
    spineId,
    spineRevisionId,
    sourceSurface: "predefined_lab",
    targetEpisodeNumber: input.targetEpisodeNumber ?? null,
    targetTitle: input.targetTitle ?? null,
    writerInstructionHash: instruction ? contentHash(normalizeComparableText(instruction)) : null,
    writerInstructionLength: instruction.length,
    selectedContextJson: JSON.stringify(input.selectedContext ?? null),
    modelId: input.modelId ?? null,
    promptMode: input.promptMode ?? null,
    createdBy: input.createdBy,
    createdAt: new Date(),
  });

  return { generationRunId: id, spineId, spineRevisionId };
}

async function resolveGeneratedLineageByContent(input: TextSnapshotInput, textRaw: string): Promise<TextSnapshotInput> {
  if (
    input.artifactType !== "predefined_episode" ||
    !["final_saved", "final_export"].includes(input.snapshotKind) ||
    input.generationRunId ||
    input.spineId ||
    !textRaw.trim()
  ) {
    return input;
  }

  const comparableHash = contentHash(normalizeComparableText(textRaw));
  const rows = await db
    .select({
      id: contentTextSnapshots.id,
      lineageId: contentTextSnapshots.lineageId,
      textRaw: contentTextSnapshots.textRaw,
      textHash: contentTextSnapshots.textHash,
      episodeNumber: contentTextSnapshots.episodeNumber,
      episodeTitle: contentTextSnapshots.episodeTitle,
      sectionUid: contentTextSnapshots.sectionUid,
      spineId: contentTextSnapshots.spineId,
      spineRevisionId: contentTextSnapshots.spineRevisionId,
      generationRunId: contentTextSnapshots.generationRunId,
    })
    .from(contentTextSnapshots)
    .where(
      and(
        eq(contentTextSnapshots.documentId, input.documentId),
        eq(contentTextSnapshots.artifactType, input.artifactType),
        eq(contentTextSnapshots.snapshotKind, "first_generation")
      )
    )
    .orderBy(desc(contentTextSnapshots.createdAt))
    .limit(50);

  let best:
    | ((typeof rows)[number] & {
        score: number;
      })
    | null = null;

  for (const row of rows) {
    if (!row.generationRunId && !row.spineId) continue;
    const score = row.textHash === comparableHash ? 1 : diceSimilarity(row.textRaw, textRaw);
    if (!best || score > best.score) best = { ...row, score };
  }

  if (!best || best.score < 0.92) return input;

  return {
    ...input,
    spineId: best.spineId ?? input.spineId ?? null,
    spineRevisionId: best.spineRevisionId ?? input.spineRevisionId ?? null,
    generationRunId: best.generationRunId ?? input.generationRunId ?? null,
    matchConfidence: "high",
    matchReason: `content_similarity:${best.score.toFixed(3)}:first_generation:${best.id}`,
    metadata: {
      ...(input.metadata ?? {}),
      lineageContentMatch: {
        firstGenerationSnapshotId: best.id,
        firstGenerationLineageId: best.lineageId,
        firstGenerationEpisodeNumber: best.episodeNumber,
        firstGenerationEpisodeTitle: best.episodeTitle,
        firstGenerationSectionUid: best.sectionUid,
        score: Number(best.score.toFixed(3)),
      },
    },
  };
}

export async function captureTextSnapshot(input: TextSnapshotInput): Promise<CaptureResult> {
  const textRaw = input.textRaw.trim();
  const resolvedInput = await resolveGeneratedLineageByContent(input, textRaw);
  const lineageId = await findOrCreateLineage(resolvedInput);
  const lineage = await db
    .select({
      sectionUid: contentLineages.sectionUid,
      spineId: contentLineages.spineId,
      generationRunId: contentLineages.generationRunId,
    })
    .from(contentLineages)
    .where(eq(contentLineages.id, lineageId))
    .limit(1);
  const effectiveSectionUid = resolvedInput.sectionUid ?? lineage[0]?.sectionUid ?? null;
  const effectiveSpineId = resolvedInput.spineId ?? lineage[0]?.spineId ?? null;
  const effectiveGenerationRunId = resolvedInput.generationRunId ?? lineage[0]?.generationRunId ?? null;
  if (!textRaw) {
    return {
      lineageId,
      snapshotId: null,
      skipped: true,
      reason: "empty",
      sectionUid: effectiveSectionUid,
      spineId: effectiveSpineId,
      spineRevisionId: resolvedInput.spineRevisionId ?? null,
      generationRunId: effectiveGenerationRunId,
    };
  }

  const textComparable = normalizeComparableText(textRaw);
  const hash = contentHash(textComparable);

  if (resolvedInput.snapshotKind === "first_generation" && resolvedInput.labRunId) {
    const existingFirst = await db
      .select({
        id: contentTextSnapshots.id,
        sectionUid: contentTextSnapshots.sectionUid,
        spineId: contentTextSnapshots.spineId,
        spineRevisionId: contentTextSnapshots.spineRevisionId,
        generationRunId: contentTextSnapshots.generationRunId,
      })
      .from(contentTextSnapshots)
      .where(
        and(
          eq(contentTextSnapshots.lineageId, lineageId),
          eq(contentTextSnapshots.snapshotKind, "first_generation"),
          eq(contentTextSnapshots.labRunId, resolvedInput.labRunId)
        )
      )
      .limit(1);
    if (existingFirst[0]?.id) {
      return {
        lineageId,
        snapshotId: existingFirst[0].id,
        skipped: true,
        reason: "first_generation_exists",
        textHash: hash,
        textLength: textRaw.length,
        sectionUid: existingFirst[0].sectionUid ?? effectiveSectionUid,
        spineId: existingFirst[0].spineId ?? effectiveSpineId,
        spineRevisionId: existingFirst[0].spineRevisionId ?? resolvedInput.spineRevisionId ?? null,
        generationRunId: existingFirst[0].generationRunId ?? effectiveGenerationRunId,
      };
    }
  }

  const latest = await db
    .select({
      id: contentTextSnapshots.id,
      textHash: contentTextSnapshots.textHash,
      sectionUid: contentTextSnapshots.sectionUid,
      spineId: contentTextSnapshots.spineId,
      spineRevisionId: contentTextSnapshots.spineRevisionId,
      generationRunId: contentTextSnapshots.generationRunId,
    })
    .from(contentTextSnapshots)
    .where(and(eq(contentTextSnapshots.lineageId, lineageId), eq(contentTextSnapshots.snapshotKind, resolvedInput.snapshotKind)))
    .orderBy(desc(contentTextSnapshots.createdAt))
    .limit(1);

  if (latest[0]?.textHash === hash) {
    return {
      lineageId,
      snapshotId: latest[0].id,
      skipped: true,
      reason: "duplicate",
      textHash: hash,
      textLength: textRaw.length,
      sectionUid: latest[0].sectionUid ?? effectiveSectionUid,
      spineId: latest[0].spineId ?? effectiveSpineId,
      spineRevisionId: latest[0].spineRevisionId ?? resolvedInput.spineRevisionId ?? null,
      generationRunId: latest[0].generationRunId ?? effectiveGenerationRunId,
    };
  }

  const snapshotId = nanoid(12);
  const metadata = buildMetadata(textRaw, resolvedInput.metadata ?? {});
  await db.insert(contentTextSnapshots).values({
    id: snapshotId,
    lineageId,
    documentId: resolvedInput.documentId,
    tabId: resolvedInput.tabId ?? null,
    artifactType: resolvedInput.artifactType,
    sourceSurface: resolvedInput.sourceSurface,
    snapshotKind: resolvedInput.snapshotKind,
    snapshotStatus: "active",
    sourceId: resolvedInput.sourceId ?? null,
    labRunId: resolvedInput.labRunId ?? null,
    labTurnId: resolvedInput.labTurnId ?? null,
    parentSnapshotId: resolvedInput.parentSnapshotId ?? null,
    turnIndex: resolvedInput.turnIndex ?? null,
    episodeNumber: resolvedInput.episodeNumber ?? null,
    episodeTitle: resolvedInput.episodeTitle ?? null,
    sectionUid: effectiveSectionUid,
    spineId: effectiveSpineId,
    spineRevisionId: resolvedInput.spineRevisionId ?? null,
    generationRunId: effectiveGenerationRunId,
    positionIndex: resolvedInput.positionIndex ?? null,
    matchConfidence: resolvedInput.matchConfidence ?? (effectiveGenerationRunId || effectiveSpineId ? "medium" : "none"),
    matchReason: resolvedInput.matchReason ?? (effectiveGenerationRunId || effectiveSpineId ? "inherited_lineage" : null),
    textRaw,
    textComparable,
    textHash: hash,
    textLength: textRaw.length,
    metadataJson: JSON.stringify(metadata),
    createdBy: resolvedInput.createdBy,
    createdAt: new Date(),
  });

  logEvent("content.lineage.snapshot.created", {
    documentId: resolvedInput.documentId,
    artifactType: resolvedInput.artifactType,
    sourceSurface: resolvedInput.sourceSurface,
    snapshotKind: resolvedInput.snapshotKind,
    lineageId,
    snapshotId,
    episodeNumber: resolvedInput.episodeNumber ?? null,
    sectionUid: effectiveSectionUid,
    spineId: effectiveSpineId,
    generationRunId: effectiveGenerationRunId,
    textHash: hash,
  });

  return {
    lineageId,
    snapshotId,
    skipped: false,
    textHash: hash,
    textLength: textRaw.length,
    sectionUid: effectiveSectionUid,
    spineId: effectiveSpineId,
    spineRevisionId: resolvedInput.spineRevisionId ?? null,
    generationRunId: effectiveGenerationRunId,
  };
}

async function previousExportEvent(lineageId: string) {
  const rows = await db
    .select({ id: contentExportEvents.id, textHash: contentExportEvents.textHash })
    .from(contentExportEvents)
    .where(eq(contentExportEvents.lineageId, lineageId))
    .orderBy(desc(contentExportEvents.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function capturePredefinedTiptapSnapshots(input: {
  documentId: string;
  tabId: string;
  contentJson: string | null;
  sourceSurface: Extract<SourceSurface, "predefined_tab" | "handoff_export">;
  snapshotKind: Extract<SnapshotKind, "final_saved" | "final_export">;
  createdBy: string;
  sourceId?: string | null;
  exportUrl?: string | null;
}): Promise<CaptureResult[]> {
  const episodes = extractEpisodeSections(input.contentJson);
  const results: CaptureResult[] = [];

  for (const episode of episodes) {
    const result = await captureTextSnapshot({
      documentId: input.documentId,
      tabId: input.tabId,
      artifactType: "predefined_episode",
      sourceSurface: input.sourceSurface,
      snapshotKind: input.snapshotKind,
      createdBy: input.createdBy,
      sourceId: input.sourceId ?? null,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.episodeTitle,
      sectionUid: episode.sectionUid,
      spineId: episode.spineId,
      generationRunId: episode.generationRunId,
      positionIndex: episode.positionIndex,
      matchConfidence: episode.generationRunId || episode.spineId || episode.sectionUid ? "high" : "medium",
      matchReason: episode.generationRunId ? "generation_run_attr" : episode.spineId ? "spine_attr" : episode.sectionUid ? "section_uid" : "episode_number_fallback",
      textRaw: episode.textRaw,
      metadata: episode.metadata,
    });
    results.push(result);

    if (input.sourceSurface === "handoff_export" && input.sourceId && result.textHash) {
      const previous = await previousExportEvent(result.lineageId);
      await db.insert(contentExportEvents).values({
        id: nanoid(12),
        documentId: input.documentId,
        exportId: input.sourceId,
        exportUrl: input.exportUrl ?? null,
        lineageId: result.lineageId,
        snapshotId: result.snapshotId,
        previousExportEventId: previous?.id ?? null,
        changedSincePreviousExport: previous ? previous.textHash !== result.textHash : true,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.episodeTitle,
        sectionUid: result.sectionUid ?? episode.sectionUid,
        spineId: result.spineId ?? episode.spineId,
        spineRevisionId: result.spineRevisionId ?? null,
        generationRunId: result.generationRunId ?? episode.generationRunId,
        positionIndex: episode.positionIndex,
        textHash: result.textHash,
        textLength: result.textLength ?? episode.textRaw.length,
        matchConfidence:
          result.generationRunId || result.spineId || result.sectionUid ? "high" : "medium",
        matchReason: result.generationRunId
          ? "generation_run"
          : result.spineId
            ? "spine"
            : result.sectionUid
              ? "section_uid"
              : "episode_number_fallback",
        createdBy: input.createdBy,
        createdAt: new Date(),
      });
    }
  }
  return results;
}
