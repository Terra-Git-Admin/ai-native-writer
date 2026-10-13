export const PITCH_LAB_PILOT_PLOT_LABELS = ["Opening", "Plot progression", "Final cliffhanger"] as const;

type PilotPlotParts = Record<(typeof PITCH_LAB_PILOT_PLOT_LABELS)[number], string>;

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parsePitchLabPilotPlotText(text: string): PilotPlotParts | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parts: Partial<PilotPlotParts> = {};
  for (const line of lines) {
    const match = line.match(/^(?:[-*]\s*)?(Opening|Plot progression|Final cliffhanger)\s*:\s*(.+)$/i);
    if (!match) return null;
    const label = PITCH_LAB_PILOT_PLOT_LABELS.find((item) => item.toLowerCase() === match[1].toLowerCase());
    if (!label || parts[label]) return null;
    parts[label] = cleanLine(match[2]);
  }
  return PITCH_LAB_PILOT_PLOT_LABELS.every((label) => parts[label]) ? parts as PilotPlotParts : null;
}

export function formatPitchLabPilotPlotText(parts: PilotPlotParts): string {
  return PITCH_LAB_PILOT_PLOT_LABELS.map((label) => `${label}: ${cleanLine(parts[label])}`).join("\n");
}

export function normalizePitchLabPilotPlotText(text: string): string {
  const parts = parsePitchLabPilotPlotText(text);
  if (!parts) throw new Error("Pilot Plot must have exactly three labeled lines: Opening, Plot progression, and Final cliffhanger.");
  return formatPitchLabPilotPlotText(parts);
}

export function validatePitchLabPilotPlotText(text: string): string[] {
  const parts = parsePitchLabPilotPlotText(text);
  if (!parts) return ["Pilot Plot must have exactly three labeled lines: Opening, Plot progression, and Final cliffhanger."];
  return [];
}

export function assertPitchLabPilotPlotText(text: string): string {
  const normalized = normalizePitchLabPilotPlotText(text);
  const errors = validatePitchLabPilotPlotText(normalized);
  if (errors.length) throw new Error(errors.join(" "));
  return normalized;
}
