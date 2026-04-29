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
    <div className="border-b border-gray-200 bg-indigo-50/40 px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
        Workbook actions
      </p>
      <div className="flex flex-col gap-1.5">
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            onClick={() => onStart(a.kind)}
            disabled={isAIBusy}
            title={a.description}
            className="text-left rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-indigo-200 disabled:hover:bg-white transition-colors"
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
};
