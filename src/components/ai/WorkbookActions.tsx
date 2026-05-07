"use client";

// Top-of-sidebar workbook action buttons. Presentation only — all job
// state, streaming output, Append/Cancel/Discard handlers live in the
// parent (AIChatSidebar) so the active-job UI survives tab switches and
// renders inline in the chat thread.
//
// This component just shows three buttons and dispatches starts.

import type { JobKind } from "@/lib/ai/useJob";

interface WorkbookActionsProps {
  isAIBusy: boolean;
  onStart: (kind: JobKind) => void;
}

// Plot Chunks is intentionally hidden from this menu pending a prompt
// quality pass — see backlog. The server still accepts plot_chunks via
// /api/ai/jobs and the prompt remains in lib/ai/prompts.ts so it can
// be re-enabled by adding the entry back here once tuned.
const ACTIONS: { kind: JobKind; label: string; description: string }[] = [
  {
    kind: "series_skeleton",
    label: "Skeleton — From Research",
    description:
      "Distill source material + existing plots into a skeleton (35–45 episodes): Series Summary, Cast (2-4 primaries), Plotline Architecture, 9-phase Phase Breakdown, More Details. Use when no predefined episodes exist yet, or you want the AI to reason from the original research.",
  },
  {
    kind: "series_skeleton_predefined",
    label: "Skeleton — From Predefined",
    description:
      "Build or update the skeleton based on existing predefined episodes and plots (authoritative). If a skeleton already exists, outputs the new version with ⚡ change callouts per section so you can review what changed before committing.",
  },
  {
    kind: "next_episode_plot",
    label: "Create Next Episode Plot",
    description:
      "Propose ONE option for the next microdrama episode plot, in [H3] format.",
  },
  {
    kind: "next_reference_episode",
    label: "Create Next Reference Episode",
    description:
      "Expand the latest microdrama plot into a full reference episode (Visual / Dialogue / V.O.).",
  },
];

export default function WorkbookActions({
  isAIBusy,
  onStart,
}: WorkbookActionsProps) {
  return (
    <div className="border-b border-gray-200 bg-indigo-50/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 shrink-0">
          Actions:
        </span>
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            onClick={() => onStart(a.kind)}
            disabled={isAIBusy}
            title={a.description}
            className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 text-[11px] text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-indigo-200 disabled:hover:bg-white transition-colors"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Display label for any AI job kind. Some (workbook actions) appear in the
// workbook button list above; others (format_tab) are header buttons. The map
// is a job-kind dictionary, not a "things shown in the workbook menu" list.
export const WORKBOOK_ACTION_LABELS: Record<JobKind, string> = {
  plot_chunks: "Create Plot Chunks",
  next_episode_plot: "Create Next Episode Plot",
  next_reference_episode: "Create Next Reference Episode",
  format_tab: "Format Tab",
  series_skeleton: "Skeleton — From Research",
  series_skeleton_predefined: "Skeleton — From Predefined",
};
