import { assertPitchLabIdeaSeedText } from "./pitch-lab-idea-seed-format";
import { assertPitchLabPilotOptionText } from "./pitch-lab-pilot-option-format";
import { assertPitchLabPilotPlotText } from "./pitch-lab-pilot-plot-format";
import { parsePitchIdeaEnvelope, type PitchIdeaEnvelope, type PitchLabContentKind } from "../pitch-lab-idea-envelope";

const CONTENT_KIND_BY_STATUS: Record<string, PitchLabContentKind | null> = {
  premise: "idea_seed",
  generated: "pilot_option",
  shortlisted: null,
  discarded: null,
  promoted: "pilot_plot",
};

export function assertPitchLabTextForKind(contentKind: PitchLabContentKind, text: string): string {
  if (contentKind === "idea_seed") return assertPitchLabIdeaSeedText(text);
  if (contentKind === "pilot_option") return assertPitchLabPilotOptionText(text);
  return assertPitchLabPilotPlotText(text);
}

export function inferPitchLabContentKind(status: string, envelope: PitchIdeaEnvelope): PitchLabContentKind | null {
  if (envelope.contentKind) return envelope.contentKind;
  const statusDefault = CONTENT_KIND_BY_STATUS[status];
  if (statusDefault) return statusDefault;
  const text = envelope.currentText;
  try {
    assertPitchLabPilotPlotText(text);
    return "pilot_plot";
  } catch {}
  try {
    assertPitchLabPilotOptionText(text);
    return "pilot_option";
  } catch {}
  try {
    assertPitchLabIdeaSeedText(text);
    return "idea_seed";
  } catch {}
  return null;
}

export function getPitchLabContentState(status: string, ideaText: string): {
  envelope: PitchIdeaEnvelope;
  contentKind: PitchLabContentKind | null;
  isValid: boolean;
  errors: string[];
} {
  const envelope = parsePitchIdeaEnvelope(ideaText);
  const contentKind = inferPitchLabContentKind(status, envelope);
  if (!contentKind) {
    return { envelope, contentKind, isValid: false, errors: ["Pitch Lab item was created before the typed pipeline and must be regenerated."] };
  }
  try {
    assertPitchLabTextForKind(contentKind, envelope.currentText);
    return { envelope, contentKind, isValid: true, errors: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pitch Lab item failed content validation.";
    return { envelope, contentKind, isValid: false, errors: [message] };
  }
}

