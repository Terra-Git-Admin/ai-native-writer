"use client";

import { useEffect, useRef, useState } from "react";

interface QualityAgentPanelProps {
  documentId: string;
  episodeTabId: string;
  episodeLabel: string;
  episodeIndex: number;
  onClose: () => void;
}

export default function QualityAgentPanel({
  documentId,
  episodeTabId,
  episodeLabel,
  episodeIndex,
  onClose,
}: QualityAgentPanelProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // Auto-scroll as output grows
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  // Fire the eval once on mount — never writes to chat history
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    setIsStreaming(true);
    setOutput("");
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/quality-eval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ episodeTabId, episodeIndex }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || "Quality eval failed");
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            setOutput(accumulated.replace(/^[012]\n/, ""));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Quality eval failed");
      } finally {
        setIsStreaming(false);
      }
    })();
  }, [documentId, episodeTabId, episodeIndex]);

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">
            Quality Agent
          </p>
          <p className="truncate text-sm font-medium text-gray-800">{episodeLabel}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-2 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          title="Close"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {isStreaming && !output && (
          <div className="flex items-center gap-2 py-4 text-sm text-violet-600">
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
            <span>Evaluating…</span>
          </div>
        )}

        {output && (
          <div className="whitespace-pre-wrap text-sm text-gray-800">{output}</div>
        )}

        {isStreaming && output && (
          <span className="inline-block h-3 w-0.5 animate-pulse bg-violet-500 align-middle ml-0.5" />
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
