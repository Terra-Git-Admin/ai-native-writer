"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface ScanFlag {
  episode: string;
  character: string;
  type: "action" | "decision" | "inaction" | "dialogue" | "no_goal" | "presence" | "object";
  moment: string;
  gap: string;
  severity: "critical" | "notable";
}

const TYPE_LABEL: Record<ScanFlag["type"], string> = {
  action: "action",
  decision: "decision",
  inaction: "inaction",
  dialogue: "dialogue",
  no_goal: "no goal",
  presence: "presence",
  object: "object",
};

interface NarrativeScanPanelProps {
  documentId: string;
  episodeTabId: string;
  onClose: () => void;
}

type Phase = "idle" | "pass1" | "pass1_done" | "pass2" | "done" | "error";

function safeParseFlag(line: string): ScanFlag | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as ScanFlag;
  } catch {
    return null;
  }
}

export default function NarrativeScanPanel({
  documentId,
  episodeTabId,
  onClose,
}: NarrativeScanPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stateText, setStateText] = useState("");
  const [flags, setFlags] = useState<ScanFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<string[]>([]);
  const [fromIndex, setFromIndex] = useState(0);
  const [toIndex, setToIndex] = useState(0);

  const stateTextRef = useRef("");
  const stateScrollRef = useRef<HTMLDivElement>(null);
  const flagsScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll state text as it streams
  useEffect(() => {
    if (phase === "pass1" && stateScrollRef.current) {
      stateScrollRef.current.scrollTop = stateScrollRef.current.scrollHeight;
    }
  }, [stateText, phase]);

  // Auto-scroll flags as they appear
  useEffect(() => {
    if (phase === "pass2" && flagsScrollRef.current) {
      flagsScrollRef.current.scrollTop = flagsScrollRef.current.scrollHeight;
    }
  }, [flags, phase]);

  // Fetch episode list for the range picker
  const fetchEpisodes = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/documents/${documentId}/narrative-scan/state?episodeTabId=${episodeTabId}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as { episodes: string[] };
      setEpisodes(data.episodes);
      setToIndex(data.episodes.length - 1);
    } catch {
      // non-critical — picker just won't show
    }
  }, [documentId, episodeTabId]);

  useEffect(() => {
    fetchEpisodes();
  }, [fetchEpisodes]);

  const runPass1 = async () => {
    setPhase("pass1");
    setStateText("");
    setFlags([]);
    setError(null);
    stateTextRef.current = "";

    try {
      const res = await fetch(
        `/api/documents/${documentId}/narrative-scan/state`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ episodeTabId, fromIndex, toIndex }),
        }
      );

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "State extraction failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        stateTextRef.current += chunk;
        setStateText(stateTextRef.current);
      }

      setPhase("pass1_done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "State extraction failed");
      setPhase("error");
    }
  };

  const runPass2 = async () => {
    setPhase("pass2");
    setFlags([]);

    try {
      const res = await fetch(
        `/api/documents/${documentId}/narrative-scan/audit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stateMap: stateTextRef.current }),
        }
      );

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Audit failed");
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
          if (flag) {
            setFlags((prev) => [...prev, flag]);
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const flag = safeParseFlag(buffer);
        if (flag) {
          setFlags((prev) => [...prev, flag]);
        }
      }

      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed");
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setStateText("");
    stateTextRef.current = "";
    setFlags([]);
    setError(null);
    setFromIndex(0);
    setToIndex(episodes.length > 0 ? episodes.length - 1 : 0);
  };

  const criticalFlags = flags.filter((f) => f.severity === "critical");
  const notableFlags = flags.filter((f) => f.severity === "notable");

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
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
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
      <div className="flex min-h-0 flex-1 flex-col">
        {/* ── IDLE ── */}
        {phase === "idle" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Scans episodes to find moments where a character decision, reaction, knowledge, or inaction isn&apos;t earned by prior on-screen context. Runs in two passes — you&apos;ll see the state map build live before the audit starts.
            </p>

            {episodes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Episode range</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">From</label>
                    <select
                      value={fromIndex}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setFromIndex(v);
                        if (v > toIndex) setToIndex(v);
                      }}
                      className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-rose-500"
                    >
                      {episodes.map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">To</label>
                    <select
                      value={toIndex}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setToIndex(v);
                        if (v < fromIndex) setFromIndex(v);
                      }}
                      className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-rose-500"
                    >
                      {episodes.map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {toIndex - fromIndex + 1} episode{toIndex - fromIndex + 1 !== 1 ? "s" : ""} selected
                  {toIndex - fromIndex + 1 === episodes.length ? " (all)" : ""}
                </p>
              </div>
            )}

            <button
              onClick={runPass1}
              className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700"
            >
              Scan {episodes.length > 0 && toIndex - fromIndex + 1 < episodes.length
                ? `Ep ${fromIndex + 1}–${toIndex + 1}`
                : "All Episodes"}
            </button>
          </div>
        )}

        {/* ── PASS 1 STREAMING ── */}
        {phase === "pass1" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "300ms" }} />
              <p className="text-xs text-muted-foreground">Pass 1: building state map…</p>
            </div>
            <div
              ref={stateScrollRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-3"
            >
              <pre className="whitespace-pre-wrap font-mono text-xs text-foreground leading-relaxed">
                {stateText || <span className="text-muted-foreground">Extracting character goals, information flows, and episode actions…</span>}
              </pre>
            </div>
          </div>
        )}

        {/* ── PASS 1 DONE — waiting for user to trigger audit ── */}
        {phase === "pass1_done" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div
              ref={stateScrollRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-3"
            >
              <pre className="whitespace-pre-wrap font-mono text-xs text-foreground leading-relaxed">
                {stateText}
              </pre>
            </div>
            <div className="shrink-0 space-y-2">
              <p className="text-xs text-muted-foreground">
                State map complete. Review above, then run the gap audit.
              </p>
              <button
                onClick={runPass2}
                className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700"
              >
                Run Gap Audit →
              </button>
            </div>
          </div>
        )}

        {/* ── PASS 2 STREAMING ── */}
        {phase === "pass2" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500" style={{ animationDelay: "300ms" }} />
              <p className="text-xs text-muted-foreground">Pass 2: auditing gaps…</p>
            </div>
            <div
              ref={flagsScrollRef}
              className="flex-1 overflow-y-auto space-y-3"
            >
              {flags.length === 0 ? (
                <p className="text-xs text-muted-foreground">Flags will appear here as they&apos;re found…</p>
              ) : (
                <FlagList flags={flags} episodeOrder={episodeOrder} byEpisode={byEpisode} />
              )}
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {phase === "done" && (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3 gap-3">
            <div className="shrink-0 flex items-center justify-between">
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
              <button
                onClick={reset}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Re-scan
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3">
              <FlagList flags={flags} episodeOrder={episodeOrder} byEpisode={byEpisode} />
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

function FlagList({
  flags,
  episodeOrder,
  byEpisode,
}: {
  flags: ScanFlag[];
  episodeOrder: string[];
  byEpisode: Record<string, ScanFlag[]>;
}) {
  if (flags.length === 0) return null;

  return (
    <>
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
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium text-foreground truncate">
                    {flag.character}
                  </span>
                  {flag.type && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground">
                      {TYPE_LABEL[flag.type] ?? flag.type}
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
              <p className="text-sm text-foreground">{flag.moment}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium">Missing: </span>
                {flag.gap}
              </p>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
