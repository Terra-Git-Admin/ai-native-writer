export const PITCH_LAB_PILOT_OPTION_LABELS = ["Hook", "Escalation", "Cliffhanger"] as const;

type PilotOptionParts = Record<(typeof PITCH_LAB_PILOT_OPTION_LABELS)[number], string>;
type PilotOptionBatchContext = {
  selectedIdea?: string;
  instruction?: string;
};

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parsePitchLabPilotOptionText(text: string): PilotOptionParts | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parts: Partial<PilotOptionParts> = {};
  for (const line of lines) {
    const match = line.match(/^(?:[-*]\s*)?(Hook|Escalation|Cliffhanger)\s*:\s*(.+)$/i);
    if (!match) return null;
    const label = PITCH_LAB_PILOT_OPTION_LABELS.find((item) => item.toLowerCase() === match[1].toLowerCase());
    if (!label || parts[label]) return null;
    parts[label] = cleanLine(match[2]);
  }
  return PITCH_LAB_PILOT_OPTION_LABELS.every((label) => parts[label]) ? parts as PilotOptionParts : null;
}

export function formatPitchLabPilotOptionText(parts: PilotOptionParts): string {
  return PITCH_LAB_PILOT_OPTION_LABELS
    .map((label) => `${label}: ${cleanLine(parts[label])}`)
    .join("\n");
}

export function normalizePitchLabPilotOptionText(text: string): string {
  const parts = parsePitchLabPilotOptionText(text);
  if (!parts) throw new Error("Pilot Option must have exactly three labeled lines: Hook, Escalation, and Cliffhanger.");
  return formatPitchLabPilotOptionText(parts);
}

export function validatePitchLabPilotOptionText(text: string): string[] {
  const parts = parsePitchLabPilotOptionText(text);
  if (!parts) return ["Pilot Option must have exactly three labeled lines: Hook, Escalation, and Cliffhanger."];
  return [];
}

export function assertPitchLabPilotOptionText(text: string): string {
  const normalized = normalizePitchLabPilotOptionText(text);
  const errors = validatePitchLabPilotOptionText(normalized);
  if (errors.length) throw new Error(errors.join(" "));
  return normalized;
}

export function validatePitchLabPilotOptionBatch(texts: string[], _context: PilotOptionBatchContext = {}): string[] {
  void _context;
  const errors: string[] = [];
  const parts = texts.map((text) => parsePitchLabPilotOptionText(text));
  if (texts.length !== 4 || parts.some((part) => !part)) {
    return ["Pilot Options must be exactly 4 valid Hook/Escalation/Cliffhanger options."];
  }
  texts.forEach((text, index) => {
    const optionErrors = validatePitchLabPilotOptionText(text);
    optionErrors.forEach((error) => errors.push(`Pilot Option ${index + 1}: ${error}`));
  });
  return errors;
}
