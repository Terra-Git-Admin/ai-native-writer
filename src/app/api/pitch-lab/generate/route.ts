import { generateText } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, pitchIdeas, pitchSources, pitchWorkspaces, tabs } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { getAIModel, getConfiguredProviders, getPitchLabArgonModel } from "@/lib/ai/providers";
import { getActivePitchLabFramework } from "@/lib/ai/pitch-lab-framework";
import { buildPitchLabSampleIdeas, buildPitchLabSamplePremises, isPitchLabSampleMode } from "@/lib/ai/pitch-lab-samples";
import { requirePitchLabAccess } from "@/lib/pitch-lab-access";
import { ensurePitchLabOwner } from "@/lib/pitch-lab-owner";
import { getPitchLabModelCandidates, pitchLabErrorMessage } from "@/lib/pitch-lab-models";
import { splitTabByH3, tiptapJsonToTagged, extractEpisodeNumber } from "@/lib/ai/context-engine";
import {
  buildPitchLabPilotBatchPrompt,
  buildPitchLabPilotBatchSystemPrompt,
  buildPitchLabEpisodePilotPrompt,
  buildPitchLabEpisodePilotSystemPrompt,
  PITCH_LAB_EPISODE_PROMPT_VERSION,
  buildPitchLabPremisePrompt,
  buildPitchLabPremiseSystemPrompt,
  cleanPitchLabTitle,
  isValidPitchLabTitle,
  PITCH_LAB_IDEA_COUNT,
  PITCH_LAB_PREMISE_COUNT,
} from "@/lib/ai/pitch-lab-prompts";
import { assertPitchLabIdeaSeedText } from "@/lib/ai/pitch-lab-idea-seed-format";
import { buildMinimalFreshIdeaPrompt, buildMinimalFreshIdeaBatchRegenerationPrompt, FRESH_IDEA_INSIGHTS, parseMinimalIdeaLines, pickMinimalIdeaHeading, PITCH_LAB_MINIMAL_IDEA_PROMPT_VERSION } from "@/lib/ai/pitch-lab-minimal-ideas";
import { parsePitchLabEpisodePilots } from "@/lib/ai/pitch-lab-episode-pilot";
import { assertPitchLabPilotOptionText, validatePitchLabPilotOptionBatch } from "@/lib/ai/pitch-lab-pilot-option-format";
import { getPitchLabContentState } from "@/lib/ai/pitch-lab-content-contract";
import { loadExternalStorySource } from "@/lib/ai/pitch-lab-source-url";
import { parsePitchIdeaEnvelope, serializePitchIdeaEnvelope, type PitchLabWriterContext } from "@/lib/pitch-lab-idea-envelope";
import {
  compilePitchLabInstructions,
  formatPitchLabInstructionControls,
  scanPitchLabOutput,
  type PitchLabQaWarning,
} from "@/lib/ai/pitch-lab-instruction-compiler";

const SOURCE_LIMIT = 60_000;
const WRITER_SOURCE_BLOCK_LIMIT = 20_000;

type PitchLabPhase = "premises" | "pilots";
type ParsedPremise = { title: string; premiseText: string; appealLane: string; transformationNotes: string };
type ParsedPilotOption = { title: string; ideaText: string; kernel: string; beats: string; clarityChecks: string; adaptationNotes: string };

function mergeWriterContext(...contexts: Array<PitchLabWriterContext | undefined>): PitchLabWriterContext | undefined {
  const merged = contexts.reduce<PitchLabWriterContext>((acc, context) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(context ?? {}).filter(([, value]) => typeof value === "string" && value.trim())),
  }), {});
  return Object.values(merged).some(Boolean) ? merged : undefined;
}

function formatWriterContext(context: PitchLabWriterContext | undefined): string {
  if (!context) return "";
  const lines = [
    "WRITER CONTEXT - CARRY THIS THROUGH",
    context.workspaceBrief ? `- Original writer brief: ${context.workspaceBrief}` : "",
    context.latestInstruction ? `- Latest writer instruction: ${context.latestInstruction}` : "",
    context.selectedIdea ? `- Selected Idea: ${context.selectedIdea}` : "",
    context.selectedPilotOption ? `- Selected Pilot Option: ${context.selectedPilotOption}` : "",
    context.carriedNotes ? `- Carried notes: ${context.carriedNotes}` : "",
  ].filter(Boolean);
  return lines.length > 1 ? lines.join("\n") : "";
}

function logPitchLabGenerationOutput(input: {
  workspaceId: string;
  generationType: "framework" | "adaptation";
  adaptationStyle: "close" | "loose";
  isPlaceholder: boolean;
  sourceCount: number;
  ideas: { id: string; title: string; ideaText: string }[];
}) {
  console.info("[pitch-lab] generation.output", {
    workspaceId: input.workspaceId,
    generationType: input.generationType,
    adaptationStyle: input.adaptationStyle,
    isPlaceholder: input.isPlaceholder,
    sourceCount: input.sourceCount,
    itemCount: input.ideas.length,
    ideas: input.ideas.map((idea, index) => ({
      index,
      ideaId: idea.id,
      title: idea.title,
      wordCount: idea.ideaText.split(/\s+/).filter(Boolean).length,
    })),
  });
}

function parseModelJson(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Some providers emit literal line breaks or tabs inside quoted JSON values.
  // Escape those control characters before parsing so valid plot text is retained.
  let inString = false;
  let escaped = false;
  let repaired = "";
  for (const character of clean) {
    const code = character.charCodeAt(0);
    if (inString && !escaped && code < 0x20) {
      repaired += code === 0x0a ? "\\n" : code === 0x0d ? "\\r" : code === 0x09 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    repaired += character;
    if (inString && escaped) escaped = false;
    else if (inString && character === "\\") escaped = true;
    else if (character === '"') inString = !inString;
  }
  try {
    return JSON.parse(repaired);
  } catch {
    throw new Error("The model returned unreadable Pitch Lab JSON. Your current work is unchanged; try generating again.");
  }
}

function parsePremises(text: string): ParsedPremise[] {
  const parsed = parseModelJson(text);
  if (!Array.isArray(parsed)) throw new Error("The model returned an invalid premise list.");
  const premises = parsed.map((item) => {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.title !== "string" || typeof candidate.premiseText !== "string") return null;
    const title = cleanPitchLabTitle(candidate.title);
    const premiseText = assertPitchLabIdeaSeedText(candidate.premiseText.trim());
    return title && premiseText && isValidPitchLabTitle(title) ? {
      title,
      premiseText,
      appealLane: typeof candidate.appealLane === "string" ? candidate.appealLane.trim() : "",
      transformationNotes: typeof candidate.transformationNotes === "string" ? candidate.transformationNotes.trim() : "",
    } : null;
  }).filter((premise): premise is ParsedPremise => Boolean(premise));
  if (premises.length !== PITCH_LAB_PREMISE_COUNT) throw new Error(`The model returned ${premises.length} valid premises; expected ${PITCH_LAB_PREMISE_COUNT}. Please regenerate.`);
  return premises;
}

function parsePilotOptions(text: string, context: { selectedIdea?: string; instruction?: string } = {}): ParsedPilotOption[] {
  const parsed = parseModelJson(text);
  if (!Array.isArray(parsed)) throw new Error("The model returned an invalid Pilot Option list.");
  const ideas = parsed.map((item) => {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.title !== "string" || typeof candidate.ideaText !== "string") return null;
    const title = cleanPitchLabTitle(candidate.title);
    const ideaText = assertPitchLabPilotOptionText(candidate.ideaText.trim());
    return title && ideaText && isValidPitchLabTitle(title) ? {
      title,
      ideaText,
      kernel: typeof candidate.kernel === "string" ? candidate.kernel.trim() : "",
      beats: typeof candidate.beats === "string" ? candidate.beats.trim() : "",
      clarityChecks: typeof candidate.clarityChecks === "string" ? candidate.clarityChecks.trim() : "",
      adaptationNotes: typeof candidate.adaptationNotes === "string" ? candidate.adaptationNotes.trim() : "",
    } : null;
  }).filter((idea): idea is ParsedPilotOption => Boolean(idea));
  if (ideas.length !== PITCH_LAB_IDEA_COUNT) throw new Error(`The model returned ${ideas.length} valid Pilot Options with one- or two-word titles; expected ${PITCH_LAB_IDEA_COUNT}. Please regenerate.`);
  const batchErrors = validatePitchLabPilotOptionBatch(ideas.map((idea) => idea.ideaText), context);
  if (batchErrors.length) throw new Error(batchErrors.join(" "));
  return ideas;
}

function buildCarriedPromiseContext(input: {
  selectedPremiseEnvelope: ReturnType<typeof parsePitchIdeaEnvelope> | null;
}): string {
  const promiseInstruction = input.selectedPremiseEnvelope?.turns
    ?.map((turn) => turn.instruction)
    .find((instruction) => /^Idea batch instruction:/i.test(instruction))
    ?.replace(/^Idea batch instruction:\s*/i, "")
    .trim();
  const promiseNotes = input.selectedPremiseEnvelope?.adaptationNotes?.trim() || "";
  return [
    promiseInstruction ? `Selected idea was created from: ${promiseInstruction}` : "",
    promiseNotes ? `Selected idea notes: ${promiseNotes}` : "",
  ].filter(Boolean).join("\n");
}

function getTextFromHtml(html: string | null): string {
  const value = html ?? "";
  try {
    const parsed: unknown = JSON.parse(value);
    const parts: string[] = [];
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const record = node as { type?: unknown; text?: unknown; content?: unknown };
      if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
      if (Array.isArray(record.content)) {
        record.content.forEach(visit);
        if (["paragraph", "heading", "listItem", "blockquote"].includes(String(record.type))) parts.push("\n");
      }
    };
    visit(parsed);
    if (parts.length) return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    // Legacy documents may store HTML rather than Tiptap JSON.
  }
  return value
    .replace(/<\/(p|h[1-6]|li|div|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFirstEpisodeBlock(content: string | null): string {
  const tagged = tiptapJsonToTagged(content);
  if (tagged.trim()) {
    const sections = splitTabByH3(tagged);
    const firstEpisode = sections.find((section) => extractEpisodeNumber(section.title) === 1);
    const selected = firstEpisode ?? sections[0];
    if (selected?.content.trim()) return selected.content.trim();
    return tagged.trim();
  }
  return getTextFromHtml(content);
}

function buildWriterAdaptationSource(title: string, sourceTabs: { title: string; type: string; content: string | null }[]): string {
  const byType = (type: string) => sourceTabs.find((tab) => tab.type === type);
  const microdramaPlot = extractFirstEpisodeBlock(byType("microdrama_plots")?.content ?? null);
  const predefinedPlot = extractFirstEpisodeBlock(byType("predefined_episodes")?.content ?? null);
  const characters = (() => {
    const content = byType("characters")?.content ?? null;
    const tagged = tiptapJsonToTagged(content);
    return tagged.trim() || getTextFromHtml(content);
  })();

  return [
    `WRITER DOCUMENT ADAPTATION SOURCE: ${title}`,
    "Only the three blocks below are intended as the adaptation base. Do not mine other episodes, later plot turns, or unrelated Writer tabs.",
    `## MICRODRAMA PLOT #1\n${microdramaPlot || "(empty)"}`,
    `## PREDEFINED PLOT #1\n${predefinedPlot || "(empty)"}`,
    `## CHARACTER LIST\n${characters || "(empty)"}`,
  ].join("\n\n").slice(0, WRITER_SOURCE_BLOCK_LIMIT);
}

function splitPlainTextIntoSections(text: string): { heading: string; content: string }[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections: { heading: string; content: string }[] = [];
  let current: { heading: string; content: string[] } | null = null;
  const headingPattern = /^(?:#+\s*|\[H[1-6]\]\s*)?(.{1,90})$/i;
  const isLikelyHeading = (line: string) => {
    const normalized = line.replace(/^#+\s*|^\[H[1-6]\]\s*/i, "").replace(/:$/, "").trim();
    return normalized.length <= 90 && /(microdrama|predefined|reference episode|character|cast|episode\s*1|plot\s*#?\s*1|pilot)/i.test(normalized) && !/[.!?]$/.test(normalized);
  };
  const flush = () => {
    if (current) sections.push({ heading: current.heading, content: current.content.join("\n").trim() });
  };
  for (const line of lines) {
    const match = line.match(headingPattern);
    if (match && isLikelyHeading(line)) {
      flush();
      current = { heading: match[1].replace(/:$/, "").trim(), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  flush();
  return sections.filter((section) => section.content);
}

function trimToFirstSourceUnit(text: string): string {
  const lines = text.split(/\r?\n/);
  const secondUnitIndex = lines.findIndex((line, index) => index > 0 && /(?:episode|plot)\s*(?:#\s*)?2\b/i.test(line));
  return (secondUnitIndex > 0 ? lines.slice(0, secondUnitIndex) : lines).join("\n").trim();
}

function findExternalSection(sections: { heading: string; content: string }[], patterns: RegExp[]): string {
  const section = sections.find((candidate) => patterns.some((pattern) => pattern.test(candidate.heading)));
  return section ? trimToFirstSourceUnit(`${section.heading}\n${section.content}`) : "";
}

function classifyExternalSourceDetail(text: string, hasStructuredBlocks: boolean): "structured_blocks" | "first_episode_script" | "synopsis_or_plot_summary" {
  if (hasStructuredBlocks) return "structured_blocks";
  const scriptSignals = [
    /\b(?:INT\.|EXT\.|FADE IN|CUT TO|V\.O\.|O\.S\.)\b/i,
    /\b(?:visual|dialogue|voice\s*over|scene)\b/i,
    /^\s*[A-Z][A-Z\s'.-]{2,}:\s+.+/m,
  ].filter((pattern) => pattern.test(text)).length;
  const dialogueLineCount = (text.match(/^\s*[A-Z][A-Z\s'.-]{2,}:\s+.+$/gm) ?? []).length;
  return scriptSignals >= 2 || dialogueLineCount >= 4 ? "first_episode_script" : "synopsis_or_plot_summary";
}

function buildExternalAdaptationSource(title: string, url: string, text: string): string {
  const sections = splitPlainTextIntoSections(text);
  const microdramaPlot = findExternalSection(sections, [/microdrama/i, /plot\s*#?\s*1/i]);
  const predefinedPlot = findExternalSection(sections, [/predefined/i, /reference episode/i, /episode\s*1/i, /pilot/i]);
  const characters = findExternalSection(sections, [/characters?/i, /cast/i]);
  const rawSource = text
    .split(/\r?\n/)
    .filter((line) => !/^Source URL:/i.test(line.trim()))
    .join("\n")
    .trim();
  const hasStructuredBlocks = Boolean(microdramaPlot || predefinedPlot || characters);
  const detailType = classifyExternalSourceDetail(rawSource, hasStructuredBlocks);
  const usagePlan = detailType === "structured_blocks"
    ? "Use the structured source blocks as the selected adaptation unit. Empty blocks mean unavailable evidence; do not invent them from unrelated page material."
    : detailType === "first_episode_script"
      ? "Use the script as the selected Episode 1 source. Extract the opening hook, visible pressure engine, lead character behavior, relationship shift, turn, and cliffhanger from the script evidence."
      : "Use the synopsis or plot summary as the selected story source. Extract the central trap, relationship contradiction, protagonist pressure, major reveal or reversal, and any named character traits that are actually present.";

  const detailBlock = detailType === "structured_blocks"
    ? [
        `## MICRODRAMA PLOT #1\n${microdramaPlot || "(empty)"}`,
        `## PREDEFINED PLOT #1\n${predefinedPlot || "(empty)"}`,
        `## CHARACTER LIST\n${characters || "(empty)"}`,
      ].join("\n\n")
    : detailType === "first_episode_script"
      ? `## FIRST EPISODE SCRIPT\n${trimToFirstSourceUnit(rawSource) || "(empty)"}`
      : `## SOURCE SYNOPSIS / PLOT SUMMARY\n${rawSource || "(empty)"}`;

  return [
    `EXTERNAL LINK ADAPTATION SOURCE: ${title}`,
    `Source URL: ${url}`,
    `SOURCE DETAIL TYPE: ${detailType.replace(/_/g, " ")}`,
    usagePlan,
    detailBlock,
  ].join("\n\n").slice(0, WRITER_SOURCE_BLOCK_LIMIT);
}

export async function POST(req: Request) {
  const session = await auth();
  const accessError = requirePitchLabAccess(session);
  if (accessError) return accessError;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensurePitchLabOwner(session);

  const body = await req.json().catch(() => null);
  const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
  const sourceDocumentId = typeof body?.sourceDocumentId === "string" ? body.sourceDocumentId : null;
  const pastedSource = typeof body?.pastedSource === "string" ? body.pastedSource.trim() : "";
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const regenerateAll = body?.regenerateAll === true;
  const phase: PitchLabPhase = body?.phase === "pilots" ? "pilots" : "premises";
  const selectedPremise = typeof body?.selectedPremise === "string" ? body.selectedPremise.trim() : "";
  const selectedPremiseId = typeof body?.selectedPremiseId === "string" ? body.selectedPremiseId : "";
  const generationType = body?.generationType === "adaptation" ? "adaptation" : "framework";
  const minimalFreshIdeas = phase === "premises" && generationType === "framework" && process.env.PITCH_LAB_IDEA_EXPERIMENT_ARM === "A";
  const adaptationStyle = body?.adaptationStyle === "close" ? "close" : "loose";
  if (phase === "pilots" && !selectedPremise) {
    return NextResponse.json({ error: "Choose an Idea before generating Pilot Options." }, { status: 400 });
  }
  if (generationType === "adaptation" && !sourceDocumentId && !pastedSource && !sourceUrl) {
    return NextResponse.json({ error: "Choose a Writer story, add a public story link, or paste story material to adapt." }, { status: 400 });
  }

  const sources: { type: "writer_doc" | "pasted_text"; sourceDocumentId: string | null; title: string; text: string }[] = [];
  if (generationType === "adaptation" && sourceDocumentId) {
    const [sourceDoc] = await db.select({ id: documents.id, title: documents.title })
      .from(documents).where(eq(documents.id, sourceDocumentId)).limit(1);
    if (!sourceDoc) return NextResponse.json({ error: "The selected Writer document was not found." }, { status: 404 });
    const sourceTabs = await db.select({ title: tabs.title, type: tabs.type, content: tabs.content }).from(tabs)
      .where(eq(tabs.documentId, sourceDocumentId)).orderBy(tabs.position);
    sources.push({ type: "writer_doc", sourceDocumentId, title: sourceDoc.title, text: buildWriterAdaptationSource(sourceDoc.title, sourceTabs) });
  }
  if (generationType === "adaptation" && pastedSource) sources.push({ type: "pasted_text", sourceDocumentId: null, title: "Pasted source material", text: `Pasted source material:\n${pastedSource}` });
  if (generationType === "adaptation" && sourceUrl) {
    try {
      const externalSource = await loadExternalStorySource(sourceUrl);
      sources.push({ type: "pasted_text", sourceDocumentId: null, title: externalSource.title, text: buildExternalAdaptationSource(externalSource.title, externalSource.url, externalSource.text) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read that story link.";
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }
  const sourceMaterial = sources.map((source) => source.text).join("\n\n---\n\n").slice(0, SOURCE_LIMIT);
  const workspaceRow = db.select({ id: pitchWorkspaces.id, brief: pitchWorkspaces.brief })
    .from(pitchWorkspaces)
    .where(eq(pitchWorkspaces.ownerId, session.user.id))
    .get();
  const currentFreshIdeas = minimalFreshIdeas && regenerateAll && workspaceRow?.id
    ? db.select({ ideaText: pitchIdeas.ideaText }).from(pitchIdeas)
      .where(and(eq(pitchIdeas.workspaceId, workspaceRow.id), eq(pitchIdeas.status, "premise")))
      .orderBy(pitchIdeas.position).all()
      .map((row) => parsePitchIdeaEnvelope(row.ideaText))
      .filter((idea) => idea.generation?.pipeline === "minimal-insight-one-call" || idea.generation?.pipeline === "minimal-insight-batch-regeneration")
      .map((idea) => idea.currentText)
    : [];
  const selectedPremiseEnvelope = phase === "pilots" && selectedPremiseId && workspaceRow?.id
    ? parsePitchIdeaEnvelope(db.select({ ideaText: pitchIdeas.ideaText })
      .from(pitchIdeas)
      .where(and(eq(pitchIdeas.workspaceId, workspaceRow.id), eq(pitchIdeas.id, selectedPremiseId)))
      .limit(1)
      .get()?.ideaText || "")
    : null;
  if (phase === "pilots" && selectedPremiseId && workspaceRow?.id) {
    const selectedIdeaRow = db.select({ ideaText: pitchIdeas.ideaText, status: pitchIdeas.status })
      .from(pitchIdeas)
      .where(and(eq(pitchIdeas.workspaceId, workspaceRow.id), eq(pitchIdeas.id, selectedPremiseId)))
      .limit(1)
      .get();
    const state = selectedIdeaRow ? getPitchLabContentState(selectedIdeaRow.status, selectedIdeaRow.ideaText) : null;
    if (!state || state.contentKind !== "idea_seed" || !state.isValid) {
      return NextResponse.json({ error: "Choose a valid Idea before generating Pilot Options. Regenerate invalid legacy rows." }, { status: 400 });
    }
  }
  const carriedPromiseContext = phase === "pilots"
    ? buildCarriedPromiseContext({
        selectedPremiseEnvelope,
      })
    : "";
  const effectiveBrief = phase === "pilots"
    ? [brief || workspaceRow?.brief || "", carriedPromiseContext ? `Carried selected-idea context:\n${carriedPromiseContext}` : ""].filter(Boolean).join("\n\n")
    : brief;
  const workspaceBriefToSave = phase === "pilots" ? (brief || workspaceRow?.brief || "") : brief;
  const writerContext = phase === "pilots"
    ? mergeWriterContext(selectedPremiseEnvelope?.writerContext, {
        workspaceBrief: workspaceBriefToSave,
        latestInstruction: instruction || selectedPremiseEnvelope?.writerContext?.latestInstruction,
        selectedIdea: selectedPremise,
        carriedNotes: carriedPromiseContext || selectedPremiseEnvelope?.adaptationNotes,
      })
    : mergeWriterContext({
        workspaceBrief: brief,
        latestInstruction: instruction,
      });
  const writerContextBlock = formatWriterContext(writerContext);
  const instructionControls = compilePitchLabInstructions({
    stage: phase === "premises" ? "ideas" : "pilot_options",
    brief: effectiveBrief || brief,
    instruction,
    selectedIdea: phase === "pilots" ? selectedPremise : "",
    carriedContext: carriedPromiseContext,
    sourceMaterial,
    generationType,
  });
  const instructionControlsBlock = formatPitchLabInstructionControls(instructionControls);
  const ideaInstructionControls = minimalFreshIdeas ? undefined : instructionControls;
  let qaWarnings: PitchLabQaWarning[] = [];

  let parsedPremises: ParsedPremise[] | null = null;
  let parsedIdeas: ParsedPilotOption[] | null = null;
  let isPlaceholder = false;
  const episodePilot = phase === "pilots" && generationType === "framework" && !isPitchLabSampleMode();
  try {
    if (isPitchLabSampleMode()) {
      if (phase === "premises") {
        parsedPremises = buildPitchLabSamplePremises({
          generationType,
          adaptationStyle,
          sourceTitle: sources.map((source) => source.title).join(" + ") || "the selected story",
        });
        qaWarnings = scanPitchLabOutput(instructionControls, "ideas", parsedPremises.map((premise) => premise.premiseText));
      } else {
        const sampleIdeas = buildPitchLabSampleIdeas({
          generationType,
          adaptationStyle,
          sourceTitle: sources.map((source) => source.title).join(" + ") || "the selected story",
          selectedPremise,
        });
        if (sampleIdeas.length !== PITCH_LAB_IDEA_COUNT) {
          throw new Error(`Sample pitch batch returned ${sampleIdeas.length} Pilot Options; expected ${PITCH_LAB_IDEA_COUNT}.`);
        }
        parsedIdeas = sampleIdeas.map((idea) => ({
          ...idea,
          ideaText: assertPitchLabPilotOptionText(idea.ideaText),
          kernel: selectedPremise,
          beats: "",
          clarityChecks: "",
          adaptationNotes: "",
        }));
        qaWarnings = scanPitchLabOutput(instructionControls, "pilot_options", parsedIdeas.map((idea) => idea.ideaText));
      }
      isPlaceholder = true;
    } else {
      const providers = await getConfiguredProviders();
      if (episodePilot) {
        if (!providers.includes("google")) return NextResponse.json({ error: "Episode 1 pilots require a configured Google/Gemini API key." }, { status: 503 });
        const model = await getPitchLabArgonModel();
        const prompt = buildPitchLabEpisodePilotPrompt({ selectedPremise, brief: workspaceBriefToSave, instruction });
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const result = await generateText({
              model,
              system: buildPitchLabEpisodePilotSystemPrompt(),
              prompt: attempt === 0 ? prompt : `${prompt}\n\nReturn exactly four options using the required markers. Repair only the separators.`,
              maxOutputTokens: 12000,
              maxRetries: 0,
              providerOptions: { google: { thinkingConfig: { thinkingLevel: "high" } } },
            });
            const options = parsePitchLabEpisodePilots(result.text, PITCH_LAB_IDEA_COUNT);
            parsedIdeas = options.map((option) => ({ ...option, title: cleanPitchLabTitle(option.title), kernel: "", beats: "", clarityChecks: "", adaptationNotes: "" }));
            console.info("[pitch-lab] episode-pilot", { attempt: attempt + 1, modelId: result.response.modelId, finishReason: result.finishReason, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, reasoningTokens: result.usage.outputTokenDetails.reasoningTokens, promptVersion: PITCH_LAB_EPISODE_PROMPT_VERSION });
            lastError = null;
            break;
          } catch (error) { lastError = error; }
        }
        if (!parsedIdeas) throw lastError instanceof Error ? lastError : new Error("Episode 1 pilot generation failed.");
      } else {
      const tasteBrief = minimalFreshIdeas ? "" : await getActivePitchLabFramework();
      const candidates = phase === "premises"
        ? (providers.includes("google") ? [{ provider: "google" as const, modelId: "gemini-4-argon" }] : [])
        : getPitchLabModelCandidates(providers);
      if (!candidates.length) return NextResponse.json({ error: phase === "premises" ? "Idea seeds require a configured Google/Gemini API key for Argon." : "No AI provider is configured. Ask an admin to add an API key." }, { status: 503 });

      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          if (phase === "premises") {
            if (minimalFreshIdeas) {
              const result = await generateText({
                model: await getPitchLabArgonModel(),
                prompt: regenerateAll
                  ? buildMinimalFreshIdeaBatchRegenerationPrompt(brief, instruction, currentFreshIdeas)
                  : buildMinimalFreshIdeaPrompt(brief, instruction),
                maxOutputTokens: 32768,
                maxRetries: 0,
                providerOptions: { google: { thinkingConfig: { thinkingLevel: "medium" } } },
              });
              parsedPremises = parseMinimalIdeaLines(result.text).map((premiseText) => ({
                title: pickMinimalIdeaHeading(premiseText),
                premiseText: assertPitchLabIdeaSeedText(premiseText),
                appealLane: "",
                transformationNotes: "",
              }));
              console.info("[pitch-lab] idea-experiment", { arm: "A", promptVersion: PITCH_LAB_MINIMAL_IDEA_PROMPT_VERSION, modelId: result.response.modelId, itemCount: parsedPremises.length, finishReason: result.finishReason, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, reasoningTokens: result.usage.outputTokenDetails.reasoningTokens });
              qaWarnings = [];
            } else {
            const basePrompt = buildPitchLabPremisePrompt({ generationType, adaptationStyle, brief, instruction, sourceMaterial, instructionControls: instructionControlsBlock, writerContext: writerContextBlock });
            let parseError: unknown = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const result = await generateText({
                model: await getPitchLabArgonModel(),
                system: buildPitchLabPremiseSystemPrompt(tasteBrief),
                prompt: attempt === 0 ? basePrompt : `${basePrompt}

FORMAT REPAIR RETRY
Your previous answer did not match the required Idea format.
Return exactly ${PITCH_LAB_PREMISE_COUNT} JSON items. Each premiseText must:
- start with FL
- include ML
- be one compact seed, 8-28 words
- read like "FL nurse saves ML mobster's life and is offered a live-in contract"
Do not start with A, An, or The. Do not use em dashes, semicolons, series language, episode language, or polished premise prose.`,
                maxOutputTokens: 32768,
                maxRetries: 0,
                providerOptions: { google: { thinkingConfig: { thinkingLevel: "medium" } } },
              });
              try {
                parsedPremises = parsePremises(result.text);
                console.info("[pitch-lab] idea-seeds", { modelId: result.response.modelId, finishReason: result.finishReason, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, reasoningTokens: result.usage.outputTokenDetails.reasoningTokens });
                parseError = null;
                break;
              } catch (err) {
                parseError = err;
              }
            }
            if (!parsedPremises) throw parseError instanceof Error ? parseError : new Error("Idea generation failed format validation.");
            qaWarnings = scanPitchLabOutput(instructionControls, "ideas", parsedPremises.map((premise) => premise.premiseText));
            }
          } else {
            const basePrompt = buildPitchLabPilotBatchPrompt({ generationType, adaptationStyle, brief: effectiveBrief, instruction, sourceMaterial, selectedPremise, instructionControls: instructionControlsBlock, writerContext: writerContextBlock });
            let parseError: unknown = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const result = await generateText({
                model: await getAIModel(candidate.modelId),
                system: buildPitchLabPilotBatchSystemPrompt(tasteBrief),
                prompt: attempt === 0 ? basePrompt : `${basePrompt}

FORMAT REPAIR RETRY
Your previous answer did not match the required Pilot Option format.
Return exactly ${PITCH_LAB_IDEA_COUNT} JSON items. Each ideaText must be exactly:
Hook: one short event
Escalation: one short complication
Cliffhanger: one short next-action turn
Do not use route/routes, series arc, season, runway, Pilot arc, or episode-plan labels.
Do not introduce royal, palace, court, medieval, clan, magic, bloodline, lord/lady, or fantasy texture unless the selected Idea or latest instruction explicitly requested it.
Keep each option simple: one trigger, one complication, one next action. Do not stack multiple threats, institutions, rivals, investigations, family problems, and reveals in one option.`,
                maxOutputTokens: 14000,
                maxRetries: 0,
              });
              try {
                parsedIdeas = parsePilotOptions(result.text, { selectedIdea: selectedPremise, instruction });
                parseError = null;
                break;
              } catch (err) {
                parseError = err;
              }
            }
            if (!parsedIdeas) throw parseError instanceof Error ? parseError : new Error("Pilot Option generation failed format validation.");
            qaWarnings = scanPitchLabOutput(instructionControls, "pilot_options", parsedIdeas.map((idea) => idea.ideaText));
          }
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          console.warn("[pitch-lab] generation provider failed", {
            phase,
            provider: candidate.provider,
            modelId: candidate.modelId,
            error: pitchLabErrorMessage(err),
          });
        }
      }
      if (phase === "premises" && !parsedPremises) {
        return NextResponse.json({ error: `All configured AI providers failed. Last error: ${pitchLabErrorMessage(lastError)}` }, { status: 502 });
      }
      if (phase === "pilots" && !parsedIdeas) {
        return NextResponse.json({ error: `All configured AI providers failed. Last error: ${pitchLabErrorMessage(lastError)}` }, { status: 502 });
      }
      }
    }

    if (phase === "premises") {
      if (!parsedPremises) throw new Error("Idea generation returned no ideas.");
      const premisesToSave = parsedPremises;
      const saved = db.transaction((tx) => {
        const now = new Date();
        let workspaceId = tx.select({ id: pitchWorkspaces.id }).from(pitchWorkspaces)
          .where(eq(pitchWorkspaces.ownerId, session.user.id)).get()?.id ?? null;
        if (!workspaceId) {
          workspaceId = nanoid(12);
          tx.insert(pitchWorkspaces).values({ id: workspaceId, ownerId: session.user.id, brief, adaptationStyle: sourceMaterial ? adaptationStyle : null, createdAt: now, updatedAt: now }).run();
        } else {
          tx.update(pitchWorkspaces).set({ brief, adaptationStyle: sourceMaterial ? adaptationStyle : null, updatedAt: now })
            .where(eq(pitchWorkspaces.id, workspaceId)).run();
        }
        tx.delete(pitchSources).where(eq(pitchSources.workspaceId, workspaceId)).run();
        if (sources.length) tx.insert(pitchSources).values(sources.map((source) => ({
          id: nanoid(12), workspaceId: workspaceId!, type: source.type, sourceDocumentId: source.sourceDocumentId,
          title: source.title, textSnapshot: source.text.slice(0, SOURCE_LIMIT), createdAt: now,
        }))).run();
        tx.delete(pitchIdeas).where(and(
          eq(pitchIdeas.workspaceId, workspaceId),
          inArray(pitchIdeas.status, ["premise", "generated", "discarded"]),
        )).run();
        const existingRows = tx.select({ position: pitchIdeas.position }).from(pitchIdeas)
          .where(eq(pitchIdeas.workspaceId, workspaceId)).all();
        const startPosition = existingRows.length ? Math.max(...existingRows.map((row) => row.position)) + 1 : 0;
        const premises = premisesToSave.map((premise, index) => ({
          id: nanoid(12), workspaceId: workspaceId!,
          title: premise.title.replace(/^\[Sample\]\s*/i, ""),
          ideaText: serializePitchIdeaEnvelope({
            originalText: premise.premiseText,
            currentText: premise.premiseText,
            contentKind: "idea_seed",
            generation: minimalFreshIdeas ? { provider: "google", model: "gemini-4-argon", pipeline: regenerateAll ? "minimal-insight-batch-regeneration" : "minimal-insight-one-call", promptVersion: PITCH_LAB_MINIMAL_IDEA_PROMPT_VERSION, thinkingLevel: "medium", frameworkInsights: [...FRESH_IDEA_INSIGHTS] } : undefined,
            turns: [{
              instruction: instruction ? `Idea batch instruction: ${instruction}` : "Idea",
              ideaText: premise.premiseText,
              createdAt: now.toISOString(),
              kind: "initial",
              contentKind: "idea_seed",
              generation: minimalFreshIdeas ? { provider: "google", model: "gemini-4-argon", pipeline: regenerateAll ? "minimal-insight-batch-regeneration" : "minimal-insight-one-call", promptVersion: PITCH_LAB_MINIMAL_IDEA_PROMPT_VERSION, thinkingLevel: "medium", frameworkInsights: [...FRESH_IDEA_INSIGHTS] } : undefined,
              instructionControls: ideaInstructionControls,
              qaWarnings,
              writerContext,
            }],
            premise: premise.premiseText,
            adaptationNotes: [premise.appealLane, premise.transformationNotes].filter(Boolean).join(" | "),
            instructionControls: ideaInstructionControls,
            qaWarnings,
            writerContext,
          }),
          status: "premise" as const, position: startPosition + index, createdAt: now, updatedAt: now,
        }));
        tx.insert(pitchIdeas).values(premises).run();
        return { workspaceId, ideas: premises };
      });
      return NextResponse.json({ ...saved, phase, isPlaceholder });
    }

    if (!parsedIdeas) throw new Error("Pilot Option generation returned no options.");
    const ideasToSave = parsedIdeas;
    const saved = db.transaction((tx) => {
      const now = new Date();
      let workspaceId = tx.select({ id: pitchWorkspaces.id }).from(pitchWorkspaces)
        .where(eq(pitchWorkspaces.ownerId, session.user.id)).get()?.id ?? null;
      if (!workspaceId) {
        workspaceId = nanoid(12);
        tx.insert(pitchWorkspaces).values({ id: workspaceId, ownerId: session.user.id, brief: workspaceBriefToSave, adaptationStyle: sourceMaterial ? adaptationStyle : null, createdAt: now, updatedAt: now }).run();
      } else {
        tx.update(pitchWorkspaces).set({ brief: workspaceBriefToSave, adaptationStyle: sourceMaterial ? adaptationStyle : null, updatedAt: now })
          .where(eq(pitchWorkspaces.id, workspaceId)).run();
      }
      tx.delete(pitchSources).where(eq(pitchSources.workspaceId, workspaceId)).run();
      if (sources.length) tx.insert(pitchSources).values(sources.map((source) => ({
        id: nanoid(12), workspaceId: workspaceId!, type: source.type, sourceDocumentId: source.sourceDocumentId,
        title: source.title, textSnapshot: source.text.slice(0, SOURCE_LIMIT), createdAt: now,
      }))).run();
      const existingRows = tx.select({ position: pitchIdeas.position }).from(pitchIdeas)
        .where(eq(pitchIdeas.workspaceId, workspaceId)).all();
      const startPosition = existingRows.length ? Math.max(...existingRows.map((row) => row.position)) + 1 : 0;
      const existingIdeaRows = tx.select({ ideaText: pitchIdeas.ideaText, status: pitchIdeas.status }).from(pitchIdeas)
        .where(eq(pitchIdeas.workspaceId, workspaceId)).all();
      const existingBatchKeys = new Set<string>();
      existingIdeaRows.forEach((row) => {
        if (!["generated", "shortlisted", "discarded", "promoted"].includes(row.status)) return;
        const envelope = parsePitchIdeaEnvelope(row.ideaText);
        if (selectedPremiseId && envelope.premiseId !== selectedPremiseId) return;
        if (!selectedPremiseId && envelope.premise !== selectedPremise) return;
        existingBatchKeys.add(envelope.batchId || `legacy:${envelope.generatedAt || envelope.premise || row.ideaText.slice(0, 80)}`);
      });
      const batchId = nanoid(12);
      const generatedAt = now.toISOString();
      const batchNumber = existingBatchKeys.size + 1;
      const generated = ideasToSave.map((idea, index) => ({
        id: nanoid(12), workspaceId: workspaceId!,
        title: idea.title.replace(/^\[Sample\]\s*/i, ""),
        ideaText: serializePitchIdeaEnvelope({
          originalText: idea.ideaText,
          currentText: idea.ideaText,
          contentKind: episodePilot ? "episode_pilot" : "pilot_option",
          generation: episodePilot ? { provider: "google", model: "gemini-4-argon", pipeline: "single-call-episode-pilot", promptVersion: PITCH_LAB_EPISODE_PROMPT_VERSION, thinkingLevel: "high" } : undefined,
          turns: [{
            instruction: [
              `Selected idea: ${selectedPremise}`,
              carriedPromiseContext ? `Carried creative context: ${carriedPromiseContext}` : "",
              instruction ? `Pilot Option instruction: ${instruction}` : "",
            ].filter(Boolean).join("\n"),
            ideaText: idea.ideaText,
            createdAt: now.toISOString(),
            kind: "initial",
            contentKind: episodePilot ? "episode_pilot" : "pilot_option",
            generation: episodePilot ? { provider: "google", model: "gemini-4-argon", pipeline: "single-call-episode-pilot", promptVersion: PITCH_LAB_EPISODE_PROMPT_VERSION, thinkingLevel: "high" } : undefined,
            instructionControls,
            qaWarnings,
              writerContext: mergeWriterContext(writerContext, { selectedPilotOption: idea.ideaText }),
          }],
          premise: selectedPremise,
          premiseId: selectedPremiseId || undefined,
          batchId,
          batchNumber,
          generatedAt,
          kernel: idea.kernel,
          beats: idea.beats,
          clarityChecks: idea.clarityChecks,
          adaptationNotes: idea.adaptationNotes,
          instructionControls,
          qaWarnings,
          writerContext: mergeWriterContext(writerContext, { selectedPilotOption: idea.ideaText }),
        }),
        status: "generated" as const, position: startPosition + index, createdAt: now, updatedAt: now,
      }));
      tx.insert(pitchIdeas).values(generated).run();
      return { workspaceId, ideas: generated };
    });
    logPitchLabGenerationOutput({
      workspaceId: saved.workspaceId,
      generationType,
      adaptationStyle,
      isPlaceholder,
      sourceCount: sources.length,
      ideas: saved.ideas,
    });
    return NextResponse.json({ ...saved, isPlaceholder });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Idea generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
