"use client";

import { useRef, useState } from "react";

interface PlotScanPanelProps {
  documentId: string;
  onClose: () => void;
}

type Phase = "idle" | "analyzing" | "done" | "error";

function IntelligenceView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <p
              key={i}
              className="mt-5 mb-1 text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 first:mt-0"
            >
              {line.slice(3)}
            </p>
          );
        }
        if (line.startsWith("Score:")) {
          return (
            <p key={i} className="text-base font-semibold text-foreground">
              {line}
            </p>
          );
        }
        if (line.trim() === "") {
          return <div key={i} className="h-1.5" />;
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-foreground">
            {line}
          </p>
        );
      })}
    </div>
  );
}

export default function PlotScanPanel({
  documentId,
  onClose,
}: PlotScanPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [outputText, setOutputText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const outputScrollRef = useRef<HTMLDivElement>(null);
  const outputTextRef = useRef("");

  const runAnalyze = async () => {
    setPhase("analyzing");
    setOutputText("");
    setError(null);
    outputTextRef.current = "";

    try {
      const res = await fetch(
        `/api/documents/${documentId}/plot-scan/analyze`,
        { method: "POST" }
      );

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Analysis failed"
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        outputTextRef.current += chunk;
        setOutputText(outputTextRef.current);
        if (outputScrollRef.current) {
          outputScrollRef.current.scrollTop =
            outputScrollRef.current.scrollHeight;
        }
      }

      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setOutputText("");
    outputTextRef.current = "";
    setError(null);
  };

  return (
    <div className="flex h-full flex-col bg-muted">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">
            Story Intelligence
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            Overview · Tropes · Intelligence Load
          </p>
        </div>
        <button
          onClick={onClose}
          className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col">

        {/* IDLE */}
        {phase === "idle" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Reads all microdrama plots and returns a story intelligence card — what story is being
              written, the dominant tropes, and how much cognitive tracking viewers need to follow it.
            </p>
            <button
              onClick={runAnalyze}
              className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
            >
              Analyze Story →
            </button>
          </div>
        )}

        {/* ANALYZING */}
        {phase === "analyzing" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-violet-500"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-violet-500"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-violet-500"
                style={{ animationDelay: "300ms" }}
              />
              <p className="text-xs text-muted-foreground">Reading plots…</p>
            </div>
            <div
              ref={outputScrollRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4"
            >
              {outputText ? (
                <IntelligenceView text={outputText} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Building story intelligence report…
                </p>
              )}
            </div>
          </div>
        )}

        {/* DONE */}
        {phase === "done" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={outputScrollRef}
              className="flex-1 overflow-y-auto px-4 py-4"
            >
              <IntelligenceView text={outputText} />
            </div>
            <div className="shrink-0 border-t border-border px-4 py-3">
              <button
                onClick={reset}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Re-analyze
              </button>
            </div>
          </div>
        )}

        {/* ERROR */}
        {phase === "error" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
            <button
              onClick={reset}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Start Over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
