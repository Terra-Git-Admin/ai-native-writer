"use client";

import { useRef, useState } from "react";

interface PlotFlag {
  episode: string;
  type: "gap" | "improvement" | "lens";
  subtype: string;
  point: string;
  issue: string;
  suggestion: string;
  severity: "critical" | "notable";
}

const TYPE_META = {
  gap: {
    label: "Gap",
    color:
      "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
    badge:
      "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300",
    header: "text-red-600 dark:text-red-400",
  },
  improvement: {
    label: "Improve",
    color:
      "bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800",
    badge:
      "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300",
    header: "text-blue-600 dark:text-blue-400",
  },
  lens: {
    label: "Lens",
    color:
      "bg-violet-50 dark:bg-violet-950/30 text-violet-800 dark:text-violet-200 border-violet-200 dark:border-violet-800",
    badge:
      "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300",
    header: "text-violet-600 dark:text-violet-400",
  },
} as const;

const SUBTYPE_LABEL: Record<string, string> = {
  unmotivated_event: "unmotivated event",
  missing_setup: "missing setup",
  broken_cause_effect: "broken cause/effect",
  arc_reversal_unexplained: "arc reversal",
  no_consequence: "no consequence",
  arc_stagnant: "arc stagnant",
  weak_hook: "weak hook",
  weak_cliffhanger: "weak cliffhanger",
  event_undersized: "undersized event",
  missed_escalation: "missed escalation",
  character_passive: "character passive",
  pacing_flat: "pacing flat",
  hook_missing: "hook missing",
  cliffhanger_missing: "cliffhanger missing",
  escalation_plateau: "escalation plateau",
  format_break: "format break",
  spectacle_missing: "spectacle missing",
  tension_peak_missing: "tension peak missing",
};

interface PlotScanPanelProps {
  documentId: string;
  onClose: () => void;
}

type Phase =
  | "idle"
  | "analyzing"
  | "analyzing_done"
  | "reviewing"
  | "done"
  | "error";

type ActiveView = "all" | "gap" | "improvement" | "lens";

function safeParseFlag(line: string): PlotFlag | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as PlotFlag;
  } catch {
    return null;
  }
}

export default function PlotScanPanel({
  documentId,
  onClose,
}: PlotScanPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [structureText, setStructureText] = useState("");
  const [flags, setFlags] = useState<PlotFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("all");

  const structureTextRef = useRef("");
  const structureScrollRef = useRef<HTMLDivElement>(null);

  const runAnalyze = async () => {
    setPhase("analyzing");
    setStructureText("");
    setFlags([]);
    setError(null);
    structureTextRef.current = "";

    try {
      const res = await fetch(`/api/documents/${documentId}/plot-scan/analyze`, {
        method: "POST",
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Structure analysis failed"
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        structureTextRef.current += chunk;
        setStructureText(structureTextRef.current);
        if (structureScrollRef.current) {
          structureScrollRef.current.scrollTop =
            structureScrollRef.current.scrollHeight;
        }
      }

      setPhase("analyzing_done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("error");
    }
  };

  const runReview = async () => {
    setPhase("reviewing");
    setFlags([]);

    try {
      const res = await fetch(`/api/documents/${documentId}/plot-scan/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structureMap: structureTextRef.current }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Review failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const flag = safeParseFlag(line);
          if (flag) setFlags((prev) => [...prev, flag]);
        }
      }

      if (buffer.trim()) {
        const flag = safeParseFlag(buffer);
        if (flag) setFlags((prev) => [...prev, flag]);
      }

      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setStructureText("");
    structureTextRef.current = "";
    setFlags([]);
    setError(null);
    setActiveView("all");
  };

  const visibleFlags =
    activeView === "all" ? flags : flags.filter((f) => f.type === activeView);

  const counts = {
    gap: flags.filter((f) => f.type === "gap").length,
    improvement: flags.filter((f) => f.type === "improvement").length,
    lens: flags.filter((f) => f.type === "lens").length,
  };

  const byEpisode = visibleFlags.reduce<Record<string, PlotFlag[]>>(
    (acc, f) => {
      if (!acc[f.episode]) acc[f.episode] = [];
      acc[f.episode].push(f);
      return acc;
    },
    {}
  );

  const episodeOrder = Object.keys(byEpisode).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
    return numA - numB;
  });

  return (
    <div className="flex h-full flex-col bg-muted">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">
            Plot Scan
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            Gaps · Improvements · Microdrama Lens
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

        {/* ── IDLE ── */}
        {phase === "idle" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Scans the Microdrama Plots tab in two passes. Pass 1 builds a structural map
              — character arcs, pacing, plot logic, key events. Pass 2 flags gaps, improvement
              opportunities, and microdrama format issues.
            </p>
            <button
              onClick={runAnalyze}
              className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
            >
              Analyze Plots →
            </button>
          </div>
        )}

        {/* ── ANALYZING ── */}
        {phase === "analyzing" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <span className="h-2 w-2 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: "300ms" }} />
              <p className="text-xs text-muted-foreground">Pass 1: building structure map…</p>
            </div>
            <div
              ref={structureScrollRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-3"
            >
              <pre className="whitespace-pre-wrap font-mono text-xs text-foreground leading-relaxed">
                {structureText || (
                  <span className="text-muted-foreground">
                    Extracting character arcs, pacing, plot logic chain, and key events…
                  </span>
                )}
              </pre>
            </div>
          </div>
        )}

        {/* ── ANALYZING DONE ── */}
        {phase === "analyzing_done" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div
              ref={structureScrollRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-3"
            >
              <pre className="whitespace-pre-wrap font-mono text-xs text-foreground leading-relaxed">
                {structureText}
              </pre>
            </div>
            <div className="shrink-0 space-y-2">
              <p className="text-xs text-muted-foreground">
                Structure map complete. Review above, then run the plot review.
              </p>
              <button
                onClick={runReview}
                className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
              >
                Run Plot Review →
              </button>
            </div>
          </div>
        )}

        {/* ── REVIEWING ── */}
        {phase === "reviewing" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <span className="h-2 w-2 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: "300ms" }} />
              <p className="text-xs text-muted-foreground">Pass 2: reviewing plot…</p>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3">
              {flags.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Flags will appear here as they&apos;re found…
                </p>
              ) : (
                <FlagCards
                  episodeOrder={episodeOrder}
                  byEpisode={byEpisode}
                />
              )}
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {phase === "done" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Summary + filter bar */}
            <div className="shrink-0 border-b border-border px-4 py-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5 flex-wrap">
                  {counts.gap > 0 && (
                    <span className="rounded-full bg-red-100 dark:bg-red-950/40 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                      {counts.gap} gap{counts.gap !== 1 ? "s" : ""}
                    </span>
                  )}
                  {counts.improvement > 0 && (
                    <span className="rounded-full bg-blue-100 dark:bg-blue-950/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                      {counts.improvement} improve
                    </span>
                  )}
                  {counts.lens > 0 && (
                    <span className="rounded-full bg-violet-100 dark:bg-violet-950/40 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                      {counts.lens} lens
                    </span>
                  )}
                  {flags.length === 0 && (
                    <span className="rounded-full bg-green-100 dark:bg-green-950/40 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                      No flags found
                    </span>
                  )}
                </div>
                <button
                  onClick={reset}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Re-scan
                </button>
              </div>

              {flags.length > 0 && (
                <div className="flex gap-1">
                  {(["all", "gap", "improvement", "lens"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setActiveView(v)}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        activeView === v
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {v === "all"
                        ? `All (${flags.length})`
                        : v === "gap"
                        ? `Gaps (${counts.gap})`
                        : v === "improvement"
                        ? `Improve (${counts.improvement})`
                        : `Lens (${counts.lens})`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              <FlagCards episodeOrder={episodeOrder} byEpisode={byEpisode} />
            </div>
          </div>
        )}

        {/* ── ERROR ── */}
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

function FlagCards({
  episodeOrder,
  byEpisode,
}: {
  episodeOrder: string[];
  byEpisode: Record<string, PlotFlag[]>;
}) {
  if (episodeOrder.length === 0) return null;

  return (
    <>
      {episodeOrder.map((ep) => (
        <div key={ep} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ep}
          </p>
          {byEpisode[ep].map((flag, i) => {
            const meta = TYPE_META[flag.type] ?? TYPE_META.gap;
            return (
              <div
                key={i}
                className={`rounded-lg border p-3 space-y-1.5 ${meta.color}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`shrink-0 text-xs font-semibold ${meta.header}`}>
                      {meta.label}
                    </span>
                    {flag.subtype && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-black/10 dark:bg-white/10">
                        {SUBTYPE_LABEL[flag.subtype] ?? flag.subtype}
                      </span>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      flag.severity === "critical"
                        ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300"
                        : "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {flag.severity}
                  </span>
                </div>
                <p className="text-sm font-medium">{flag.point}</p>
                <p className="text-xs leading-relaxed opacity-80">{flag.issue}</p>
                {flag.suggestion && (
                  <p className="text-xs leading-relaxed">
                    <span className="font-medium">Fix: </span>
                    {flag.suggestion}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
