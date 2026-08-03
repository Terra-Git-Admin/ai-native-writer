"use client";

import { useState } from "react";

interface ScanFlag {
  episode: string;
  character: string;
  moment: string;
  gap: string;
  severity: "critical" | "notable";
}

interface NarrativeScanPanelProps {
  documentId: string;
  episodeTabId: string;
  onClose: () => void;
}

type ScanPhase = "idle" | "pass1" | "pass2" | "done" | "error";

export default function NarrativeScanPanel({
  documentId,
  episodeTabId,
  onClose,
}: NarrativeScanPanelProps) {
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [flags, setFlags] = useState<ScanFlag[]>([]);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setPhase("pass1");
    setFlags([]);
    setError(null);

    try {
      setPhase("pass2");

      const res = await fetch(`/api/documents/${documentId}/narrative-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeTabId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Scan failed");
      }

      const data = (await res.json()) as { flags: ScanFlag[]; episodeCount: number };
      setFlags(data.flags);
      setEpisodeCount(data.episodeCount);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setPhase("error");
    }
  };

  const criticalFlags = flags.filter((f) => f.severity === "critical");
  const notableFlags = flags.filter((f) => f.severity === "notable");

  // Group flags by episode for display
  const byEpisode = flags.reduce<Record<string, ScanFlag[]>>((acc, f) => {
    if (!acc[f.episode]) acc[f.episode] = [];
    acc[f.episode].push(f);
    return acc;
  }, {});

  const episodeOrder = Object.keys(byEpisode).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
    return numA - numB;
  });

  return (
    <div className="flex h-full flex-col bg-muted">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">
            Story Scan
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            Viewer Journey Gaps
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
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Scans all episodes to find moments where a character decision, reaction, or inaction isn&apos;t earned by prior viewer context.
            </p>
            <button
              onClick={runScan}
              className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700"
            >
              Scan All Episodes
            </button>
          </div>
        )}

        {(phase === "pass1" || phase === "pass2") && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "300ms" }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {phase === "pass1"
                ? "Pass 1: Mapping story state across all episodes…"
                : "Pass 2: Auditing viewer journey gaps…"}
            </p>
            <p className="text-xs text-muted-foreground">This takes 30–60 seconds for a full series.</p>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
            <button
              onClick={runScan}
              className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700"
            >
              Retry Scan
            </button>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {episodeCount} episode{episodeCount !== 1 ? "s" : ""} scanned
              </p>
              <div className="flex gap-2">
                {criticalFlags.length > 0 && (
                  <span className="rounded-full bg-red-100 dark:bg-red-950/40 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                    {criticalFlags.length} critical
                  </span>
                )}
                {notableFlags.length > 0 && (
                  <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    {notableFlags.length} notable
                  </span>
                )}
                {flags.length === 0 && (
                  <span className="rounded-full bg-green-100 dark:bg-green-950/40 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                    No gaps found
                  </span>
                )}
              </div>
            </div>

            {/* Flags by episode */}
            {episodeOrder.map((ep) => (
              <div key={ep} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {ep}
                </p>
                {byEpisode[ep].map((flag, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-card p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {flag.character}
                      </span>
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
                    <p className="text-sm text-foreground">{flag.moment}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium">Missing: </span>
                      {flag.gap}
                    </p>
                  </div>
                ))}
              </div>
            ))}

            <button
              onClick={runScan}
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Re-scan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
