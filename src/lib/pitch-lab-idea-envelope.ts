export type PitchIdeaTurn = {
  instruction: string;
  ideaText: string;
  createdAt: string;
};

export type PitchIdeaEnvelope = {
  originalText: string;
  currentText: string;
  turns: PitchIdeaTurn[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parsePitchIdeaEnvelope(value: string): PitchIdeaEnvelope {
  const fallback = value.trim();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.currentText !== "string") {
      throw new Error("Not an idea envelope.");
    }
    const originalText = typeof parsed.originalText === "string" ? parsed.originalText : parsed.currentText;
    const turns = Array.isArray(parsed.turns)
      ? parsed.turns
          .map((turn): PitchIdeaTurn | null => {
            if (!isRecord(turn) || typeof turn.ideaText !== "string") return null;
            return {
              instruction: typeof turn.instruction === "string" ? turn.instruction : "",
              ideaText: turn.ideaText,
              createdAt: typeof turn.createdAt === "string" ? turn.createdAt : "",
            };
          })
          .filter((turn): turn is PitchIdeaTurn => Boolean(turn))
      : [];
    return { originalText, currentText: parsed.currentText, turns };
  } catch {
    return { originalText: fallback, currentText: fallback, turns: [] };
  }
}

export function serializePitchIdeaEnvelope(envelope: PitchIdeaEnvelope): string {
  return JSON.stringify({
    originalText: envelope.originalText,
    currentText: envelope.currentText,
    turns: envelope.turns,
  });
}
