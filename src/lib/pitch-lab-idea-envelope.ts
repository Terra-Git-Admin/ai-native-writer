export type PitchIdeaTurn = {
  instruction: string;
  ideaText: string;
  createdAt: string;
  kind?: "initial" | "rewrite" | "manual_edit" | "restore" | "rerun";
  contentKind?: PitchLabContentKind;
  kernel?: string;
  beats?: string;
  clarityChecks?: string;
  adaptationNotes?: string;
  instructionControls?: unknown;
  qaWarnings?: unknown[];
  writerContext?: PitchLabWriterContext;
  feedback?: PitchLabFeedback;
  generation?: PitchLabGeneration;
};

export type PitchLabContentKind = "idea_seed" | "pilot_option" | "pilot_plot" | "episode_pilot";

export type PitchLabFeedback = { rating: "up" | "down"; reason?: string; updatedAt: string };
export type PitchLabGeneration = { provider: "google"; model: string; pipeline: string; promptVersion: string; thinkingLevel: "medium" | "high"; frameworkInsights?: string[] };

export type PitchLabWriterContext = {
  workspaceBrief?: string;
  latestInstruction?: string;
  selectedIdea?: string;
  selectedPilotOption?: string;
  carriedNotes?: string;
};

export type PitchIdeaEnvelope = {
  originalText: string;
  currentText: string;
  contentKind?: PitchLabContentKind;
  turns: PitchIdeaTurn[];
  feedback?: PitchLabFeedback;
  generation?: PitchLabGeneration;
  premise?: string;
  premiseId?: string;
  batchId?: string;
  batchNumber?: number;
  generatedAt?: string;
  shortlistedAt?: string;
  kernel?: string;
  beats?: string;
  clarityChecks?: string;
  adaptationNotes?: string;
  instructionControls?: unknown;
  qaWarnings?: unknown[];
  writerContext?: PitchLabWriterContext;
};

export function cleanPitchIdeaText(value: string): string {
  return value
    .replace(/\n{0,2}\[Sample refinement applied:[\s\S]*?\]\s*$/gi, "")
    .replace(/\n{0,2}\[(?:Sample refinement applied|Debug|Feedback):[^\]]*\]\s*/gi, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseContentKind(value: unknown): PitchLabContentKind | undefined {
  return value === "idea_seed" || value === "pilot_option" || value === "pilot_plot" || value === "episode_pilot" ? value : undefined;
}

function parseFeedback(value: unknown): PitchLabFeedback | undefined {
  if (!isRecord(value) || (value.rating !== "up" && value.rating !== "down")) return undefined;
  return { rating: value.rating, reason: typeof value.reason === "string" ? value.reason.trim() : undefined, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "" };
}

function parseGeneration(value: unknown): PitchLabGeneration | undefined {
  if (!isRecord(value) || value.provider !== "google" || typeof value.model !== "string" || typeof value.pipeline !== "string" || typeof value.promptVersion !== "string" || (value.thinkingLevel !== "medium" && value.thinkingLevel !== "high")) return undefined;
  return { provider: "google", model: value.model, pipeline: value.pipeline, promptVersion: value.promptVersion, thinkingLevel: value.thinkingLevel, frameworkInsights: Array.isArray(value.frameworkInsights) ? value.frameworkInsights.filter((insight): insight is string => typeof insight === "string") : undefined };
}

function parseWriterContext(value: unknown): PitchLabWriterContext | undefined {
  if (!isRecord(value)) return undefined;
  const context: PitchLabWriterContext = {
    workspaceBrief: typeof value.workspaceBrief === "string" ? cleanPitchIdeaText(value.workspaceBrief) : undefined,
    latestInstruction: typeof value.latestInstruction === "string" ? cleanPitchIdeaText(value.latestInstruction) : undefined,
    selectedIdea: typeof value.selectedIdea === "string" ? cleanPitchIdeaText(value.selectedIdea) : undefined,
    selectedPilotOption: typeof value.selectedPilotOption === "string" ? cleanPitchIdeaText(value.selectedPilotOption) : undefined,
    carriedNotes: typeof value.carriedNotes === "string" ? cleanPitchIdeaText(value.carriedNotes) : undefined,
  };
  return Object.values(context).some(Boolean) ? context : undefined;
}

export function parsePitchIdeaEnvelope(value: string): PitchIdeaEnvelope {
  const fallback = cleanPitchIdeaText(value);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.currentText !== "string") {
      throw new Error("Not an idea envelope.");
    }
    const originalText = cleanPitchIdeaText(typeof parsed.originalText === "string" ? parsed.originalText : parsed.currentText);
    const turns = Array.isArray(parsed.turns)
      ? parsed.turns
          .map((turn): PitchIdeaTurn | null => {
            if (!isRecord(turn) || typeof turn.ideaText !== "string") return null;
            return {
              instruction: typeof turn.instruction === "string" ? turn.instruction : "",
              ideaText: cleanPitchIdeaText(turn.ideaText),
              createdAt: typeof turn.createdAt === "string" ? turn.createdAt : "",
              kind: typeof turn.kind === "string" ? turn.kind as PitchIdeaTurn["kind"] : undefined,
              contentKind: parseContentKind(turn.contentKind),
              kernel: typeof turn.kernel === "string" ? turn.kernel : undefined,
              beats: typeof turn.beats === "string" ? turn.beats : undefined,
              clarityChecks: typeof turn.clarityChecks === "string" ? turn.clarityChecks : undefined,
              adaptationNotes: typeof turn.adaptationNotes === "string" ? turn.adaptationNotes : undefined,
              instructionControls: turn.instructionControls,
              qaWarnings: Array.isArray(turn.qaWarnings) ? turn.qaWarnings : undefined,
              writerContext: parseWriterContext(turn.writerContext),
              feedback: parseFeedback(turn.feedback),
              generation: parseGeneration(turn.generation),
            };
          })
          .filter((turn): turn is PitchIdeaTurn => Boolean(turn))
      : [];
    const feedback = parseFeedback(parsed.feedback);
    return {
      originalText,
      currentText: cleanPitchIdeaText(parsed.currentText),
      contentKind: parseContentKind(parsed.contentKind),
      turns,
      feedback,
      generation: parseGeneration(parsed.generation),
      premise: typeof parsed.premise === "string" ? parsed.premise : undefined,
      premiseId: typeof parsed.premiseId === "string" ? parsed.premiseId : undefined,
      batchId: typeof parsed.batchId === "string" ? parsed.batchId : undefined,
      batchNumber: typeof parsed.batchNumber === "number" ? parsed.batchNumber : undefined,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
      shortlistedAt: typeof parsed.shortlistedAt === "string" ? parsed.shortlistedAt : undefined,
      kernel: typeof parsed.kernel === "string" ? parsed.kernel : undefined,
      beats: typeof parsed.beats === "string" ? parsed.beats : undefined,
      clarityChecks: typeof parsed.clarityChecks === "string" ? parsed.clarityChecks : undefined,
      adaptationNotes: typeof parsed.adaptationNotes === "string" ? parsed.adaptationNotes : undefined,
      instructionControls: parsed.instructionControls,
      qaWarnings: Array.isArray(parsed.qaWarnings) ? parsed.qaWarnings : undefined,
      writerContext: parseWriterContext(parsed.writerContext),
    };
  } catch {
    return { originalText: fallback, currentText: fallback, turns: [] };
  }
}

function serializeWriterContext(context: PitchLabWriterContext | undefined): PitchLabWriterContext | undefined {
  if (!context) return undefined;
  const serialized: PitchLabWriterContext = {
    workspaceBrief: context.workspaceBrief ? cleanPitchIdeaText(context.workspaceBrief) : undefined,
    latestInstruction: context.latestInstruction ? cleanPitchIdeaText(context.latestInstruction) : undefined,
    selectedIdea: context.selectedIdea ? cleanPitchIdeaText(context.selectedIdea) : undefined,
    selectedPilotOption: context.selectedPilotOption ? cleanPitchIdeaText(context.selectedPilotOption) : undefined,
    carriedNotes: context.carriedNotes ? cleanPitchIdeaText(context.carriedNotes) : undefined,
  };
  return Object.values(serialized).some(Boolean) ? serialized : undefined;
}

export function serializePitchIdeaEnvelope(envelope: PitchIdeaEnvelope): string {
  return JSON.stringify({
    originalText: cleanPitchIdeaText(envelope.originalText),
    currentText: cleanPitchIdeaText(envelope.currentText),
    contentKind: envelope.contentKind,
    turns: envelope.turns.map((turn) => ({
      ...turn,
      ideaText: cleanPitchIdeaText(turn.ideaText),
      writerContext: serializeWriterContext(turn.writerContext),
    })),
    feedback: envelope.feedback
      ? {
          rating: envelope.feedback.rating,
          reason: envelope.feedback.reason?.trim() || undefined,
          updatedAt: envelope.feedback.updatedAt,
        }
      : undefined,
    generation: envelope.generation,
    premise: envelope.premise,
    premiseId: envelope.premiseId,
    batchId: envelope.batchId,
    batchNumber: envelope.batchNumber,
    generatedAt: envelope.generatedAt,
    shortlistedAt: envelope.shortlistedAt,
    kernel: envelope.kernel,
    beats: envelope.beats,
    clarityChecks: envelope.clarityChecks,
    adaptationNotes: envelope.adaptationNotes,
    instructionControls: envelope.instructionControls,
    qaWarnings: envelope.qaWarnings,
    writerContext: serializeWriterContext(envelope.writerContext),
  });
}
