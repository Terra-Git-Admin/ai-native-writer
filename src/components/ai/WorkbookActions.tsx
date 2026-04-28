"use client";

// Workbook-tab AI actions panel. Shown at the top of the AI sidebar when the
// active tab is workbook. Replaces the previous single "Generate Adaptation
// State" quick-action with a suite of three durable, server-side jobs:
//
//   - Create Plot Chunks
//   - Create Next Episode Plot
//   - Create Next Reference Episode
//
// (Brainstorm Dialogues v2 will land here as a fourth.)
//
// Each click POSTs to /api/ai/jobs and subscribes to /api/ai/jobs/:id/stream
// via EventSource. The job continues server-side even if the browser tab is
// switched or the page reloads (out of scope for v1 reattach). Block-and-toast:
// the buttons disable while a job in this tab is running.
//
// On completion the writer reviews the output and clicks "Append to workbook"
// to merge the result into the workbook tab body via the editor's
// setFullContent. From there the writer manually moves the content to the
// right outline tab.

import { useJob, type JobKind } from "@/lib/ai/useJob";

interface WorkbookActionsProps {
  documentId: string;
  tabId: string;
  modelId: string;
  thinking: boolean;
  // Returns the current workbook content as tagged text, so we can append.
  getCurrentTagged: () => string;
  // Replaces the workbook content with merged tagged text.
  applyMergedContent: (taggedContent: string) => void;
}

const ACTIONS: { kind: JobKind; label: string; description: string }[] = [
  {
    kind: "plot_chunks",
    label: "Create Plot Chunks",
    description:
      "Propose plot chunks (one beat each) that can play across the next ~5 episodes.",
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

const KIND_LABEL: Record<JobKind, string> = {
  plot_chunks: "Plot Chunks",
  next_episode_plot: "Next Episode Plot",
  next_reference_episode: "Next Reference Episode",
};

export default function WorkbookActions({
  documentId,
  tabId,
  modelId,
  thinking,
  getCurrentTagged,
  applyMergedContent,
}: WorkbookActionsProps) {
  const { state, start, cancel, reset } = useJob({
    documentId,
    tabId,
    modelId,
    thinking,
  });

  const isWorking =
    state.status === "starting" || state.status === "running";

  const handleStart = async (kind: JobKind) => {
    const r = await start(kind);
    if (!r.ok && r.error) {
      // Block-and-toast: a job is already running. We just rely on the
      // disabled state to communicate this; if the user clicks anyway
      // (race on rapid double-click) we surface a small inline error.
      // The hook reset is not appropriate here — the existing job continues.
      // Show error briefly via the panel below; reset itself once the user
      // dismisses the existing job.
      // For v1 simplicity we don't wire a toast; the disabled state covers
      // the common case.
      console.warn("[ai-job] start refused:", r.error);
    }
  };

  const handleAppend = () => {
    if (!state.output || state.status !== "completed") return;
    const current = getCurrentTagged();
    const merged = current.trim()
      ? `${current.trim()}\n\n${state.output.trim()}`
      : state.output.trim();
    applyMergedContent(merged);
    reset();
  };

  const handleDiscard = () => {
    reset();
  };

  return (
    <div className="border-b border-gray-200 bg-indigo-50/40 px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
        Workbook actions
      </p>

      {/* Three action buttons. Disabled while a job is in flight. */}
      <div className="flex flex-col gap-1.5">
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            onClick={() => handleStart(a.kind)}
            disabled={isWorking}
            title={a.description}
            className="text-left rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-indigo-200 disabled:hover:bg-white transition-colors"
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Active-job panel. Shown whenever the hook is non-idle. */}
      {state.status !== "idle" && (
        <div className="mt-3 rounded-md border border-indigo-300 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-indigo-700">
              {state.kind ? KIND_LABEL[state.kind] : "AI generation"}
              <span className="ml-2 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-normal text-indigo-700">
                {statusLabel(state.status)}
              </span>
            </p>
            {isWorking && (
              <button
                onClick={cancel}
                className="text-xs font-medium text-red-600 hover:text-red-700"
              >
                Cancel
              </button>
            )}
            {!isWorking && (
              <button
                onClick={handleDiscard}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                Dismiss
              </button>
            )}
          </div>

          {state.error && (
            <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
              {state.error}
            </p>
          )}

          {state.output && (
            <pre className="mt-2 max-h-64 overflow-y-auto rounded-md border border-gray-100 bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-800 whitespace-pre-wrap font-sans">
              {state.output}
            </pre>
          )}

          {state.status === "completed" && state.output && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleDiscard}
                className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Discard
              </button>
              <button
                onClick={handleAppend}
                className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Append to workbook
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function statusLabel(s: string): string {
  if (s === "starting") return "Starting…";
  if (s === "running") return "Generating…";
  if (s === "completed") return "Done";
  if (s === "failed") return "Failed";
  if (s === "cancelled") return "Cancelled";
  return s;
}
