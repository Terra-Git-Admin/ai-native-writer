import { parseCharacterProfiles } from "@/lib/ai/characters";
import type { PromptKind } from "@/lib/ai/jobs";

export interface JobResultJson {
  content?: string;
  apply?: {
    clientApplyId: string;
    landedTabId: string;
    fellBack: boolean;
    appliedAt: string;
  };
  finishReason?: string;
  usage?: unknown;
}

export function parseJobResultJson(raw: string | null): JobResultJson {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as JobResultJson;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function applyModeForPromptKind(kind: string): "replace" | "append" {
  return kind === "format_tab" || kind === "prepare_character_questionnaire" ? "replace" : "append";
}

export interface DialogueCapResult {
  content: string;
  cap: number;
  beforeCount: number;
  afterCount: number;
  changed: boolean;
}

function extractEpisodeNumberFromOutput(content: string): number | null {
  const match = content.match(/(?:^\s*(?:\[H[123]\]\s*)?Episode\s+)(\d+)/im);
  return match ? Number(match[1]) : null;
}

export function dialogueCapForReferenceEpisode(content: string): number {
  const episodeNumber = extractEpisodeNumberFromOutput(content);
  return episodeNumber != null && episodeNumber <= 3 ? 14 : 16;
}

export function isSpokenDialogueLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('"')) return false;
  if (/\bV\.O\.\s*:/i.test(trimmed) || /\(V\.O\.\)/i.test(trimmed)) return false;
  return /^(?:\[P\]\s*)?[A-Z][A-Z0-9 .'\u2019()/-]{0,80}(?:\s*\([^)]*\))?\s*:\s*"[^"]+"/.test(trimmed);
}

export function countSpokenDialogueLines(content: string): number {
  return content.split(/\r?\n/).filter(isSpokenDialogueLine).length;
}

export function enforceReferenceEpisodeDialogueCap(content: string): DialogueCapResult {
  const cap = dialogueCapForReferenceEpisode(content);
  const beforeCount = countSpokenDialogueLines(content);
  if (beforeCount <= cap) {
    return { content, cap, beforeCount, afterCount: beforeCount, changed: false };
  }

  let keptDialogue = 0;
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    if (!isSpokenDialogueLine(line)) return true;
    keptDialogue += 1;
    return keptDialogue <= cap;
  });
  const nextContent = filtered.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return {
    content: nextContent,
    cap,
    beforeCount,
    afterCount: countSpokenDialogueLines(nextContent),
    changed: true,
  };
}

export function validateJobOutput(
  kind: PromptKind | string,
  content: string
): { ok: true } | { ok: false; reason: string } {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: "AI output was empty." };

  if (kind === "next_reference_episode") {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const hasEpisodeHeading = lines.some((line) =>
      /^\[H[123]\]\s*Episode\s+\d+/i.test(line) ||
      /^Episode\s+\d+/i.test(line)
    );
    const hasBodyTag = /\[(P|OL|UL)\]\s+\S/i.test(trimmed);
    const isTitleOnly =
      lines.length <= 2 &&
      lines.every((line) =>
        /^(?:\[H[123]\]\s*)?Episode\s+\d+\s*[:\u2014\u2013-]\s*\S+/i.test(line)
      );

    if (trimmed.length < 1200 || !hasEpisodeHeading || !hasBodyTag || isTitleOnly) {
      return {
        ok: false,
        reason: "AI output was incomplete. Nothing was appended.",
      };
    }
  }

  if (
    kind === "pilot_episode" ||
    kind === "series_skeleton" ||
    kind === "series_skeleton_predefined" ||
    kind === "series_skeleton_auto"
  ) {
    if (trimmed.length < 1200 || !/\[(H1|H2|H3|P|OL|UL)\]\s+\S/i.test(trimmed)) {
      return {
        ok: false,
        reason: "AI output was incomplete. Nothing was appended.",
      };
    }
  }

  if (kind === "prepare_character_questionnaire") {
    const hasCharactersHeading = /^\[H1\]\s*Characters\s*$/im.test(trimmed);
    const headings = parseCharacterProfiles(trimmed).map((profile) => profile.name);
    const hasQuestionnaireText = /Personality Q:|Voice Q:|Personality answer:|Voice answer:|Sample dialogue answer:|Relationship Q|Your answer/i.test(trimmed);
    if (trimmed.length < 40 || !hasCharactersHeading || headings.length === 0 || hasQuestionnaireText) {
      return { ok: false, reason: "Character cast preparation was incomplete. Nothing was replaced." };
    }
  }

  return { ok: true };
}
