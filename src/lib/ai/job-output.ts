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
  return kind === "format_tab" ? "replace" : "append";
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

  return { ok: true };
}
