export type PitchIdeaTurn = {
  instruction: string;
  ideaText: string;
  createdAt: string;
  kind?: "initial" | "rewrite" | "manual_edit" | "restore" | "rerun";
  kernel?: string;
  beats?: string;
  clarityChecks?: string;
  adaptationNotes?: string;
};

export type PitchIdeaEnvelope = {
  originalText: string;
  currentText: string;
  turns: PitchIdeaTurn[];
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
              kernel: typeof turn.kernel === "string" ? turn.kernel : undefined,
              beats: typeof turn.beats === "string" ? turn.beats : undefined,
              clarityChecks: typeof turn.clarityChecks === "string" ? turn.clarityChecks : undefined,
              adaptationNotes: typeof turn.adaptationNotes === "string" ? turn.adaptationNotes : undefined,
            };
          })
          .filter((turn): turn is PitchIdeaTurn => Boolean(turn))
      : [];
    return {
      originalText,
      currentText: cleanPitchIdeaText(parsed.currentText),
      turns,
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
    };
  } catch {
    return { originalText: fallback, currentText: fallback, turns: [] };
  }
}

export function serializePitchIdeaEnvelope(envelope: PitchIdeaEnvelope): string {
  return JSON.stringify({
    originalText: cleanPitchIdeaText(envelope.originalText),
    currentText: cleanPitchIdeaText(envelope.currentText),
    turns: envelope.turns.map((turn) => ({ ...turn, ideaText: cleanPitchIdeaText(turn.ideaText) })),
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
  });
}
