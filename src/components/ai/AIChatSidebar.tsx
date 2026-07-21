"use client";

import { useState, useRef, useEffect, useCallback, RefObject } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import type { EditorHandle } from "@/components/editor/Editor";
import { buildAIContext, buildPipelineStepContext, tiptapJsonToTagged } from "@/lib/ai/context-engine";
import type { useJob, JobKind } from "@/lib/ai/useJob";
import type { ApplyToTabResult } from "@/app/doc/[id]/page";

type AIJobController = ReturnType<typeof useJob>;

const JOB_LABELS: Partial<Record<JobKind, string>> = {
  next_reference_episode: "Create Pre-defined Episode",
};

function applyModeForKind(kind: JobKind): "replace" | "append" {
  return kind === "format_tab" ? "replace" : "append";
}

// ─── Types ───

type Mode =
  | "edit" | "draft" | "feedback" | "format" | "chat"
  | "pipe_world_state" | "pipe_beat_gen" | "pipe_causality" | "pipe_plot_synth";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type HistoryEntry =
  | { type: "mode-change"; id?: string; mode: Mode; timestamp: number }
  | { type: "message"; id?: string; role: "user" | "assistant"; content: string; mode: Mode };

const MODE_LABELS: Record<Mode, string> = {
  edit: "Edit Selection",
  draft: "Story Creation",
  feedback: "Document Feedback",
  format: "Format Document",
  chat: "Chat",
  pipe_world_state: "Build World",
  pipe_beat_gen: "Suggest Beats",
  pipe_causality: "Connect the Story",
  pipe_plot_synth: "Write Plots",
};

// Strip structural tags ([H1] [P] [UL] etc.) and [CHANGE] scaffolding for
// display. Writers see just the prose — they copy anything actionable by hand.
function stripTagsForDisplay(text: string): string {
  const changeBlocks = text.split(/\[CHANGE \d+\]/i);
  let working = text;
  if (changeBlocks.length > 1) {
    working = changeBlocks
      .slice(1)
      .map((block) => block.match(/Suggested:\s*([\s\S]*?)$/i)?.[1]?.trim() ?? "")
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
  return working
    .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")
    .split("\n")
    .map((l) => l.replace(/^\[(?:H\d|OL|UL|P|HR)\]\s*/, ""))
    .filter((l) => l.trim())
    .join("\n");
}

// ─── Props ───

interface AIChatSidebarProps {
  documentId: string;
  tabs: TabRow[];
  activeTab: TabRow;
  editorRef: RefObject<EditorHandle | null>;
  editorIsEmpty: boolean;
  modelId: string;
  thinking: boolean;
  aiJob: AIJobController;
  onApplyToTab: (originTabId: string, content: string, mode: "replace" | "append", opts?: { label?: string }) => Promise<ApplyToTabResult>;
  onFlushPendingSave: () => Promise<void>;
  onSetModel: (modelId: string) => void;
  onSetThinking: (enabled: boolean) => void;
  onSetTitle: (title: string) => void;
  onClose: () => void;
}

export default function AIChatSidebar({
  documentId,
  tabs,
  activeTab,
  editorRef,
  modelId,
  thinking,
  aiJob,
  onApplyToTab,
  onFlushPendingSave,
  onSetModel,
  onSetThinking,
  onClose,
}: AIChatSidebarProps) {
  type PipelineStepId =
    | "pipe_world_state"
    | "pipe_beat_gen"
    | "pipe_causality"
    | "pipe_plot_synth";

  const PIPELINE_STEPS: {
    id: PipelineStepId;
    label: string;
    enabledWhenTabType: string;
    requiredTabLabel: string;
  }[] = [
    { id: "pipe_world_state", label: "Build World",       enabledWhenTabType: "series_overview", requiredTabLabel: "Series Overview" },
    { id: "pipe_beat_gen",    label: "Suggest Beats",     enabledWhenTabType: "world_state",     requiredTabLabel: "World State" },
    { id: "pipe_causality",   label: "Connect the Story", enabledWhenTabType: "beat_sequence",   requiredTabLabel: "Beats" },
    { id: "pipe_plot_synth",  label: "Write Plots",       enabledWhenTabType: "story_logic",     requiredTabLabel: "Story Logic" },
  ];

  const [activeStep, setActiveStep] = useState<PipelineStepId | null>(null);
  const mode: Mode = activeStep ?? "chat";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    try { return localStorage.getItem("ai-send-on-enter") === "true"; } catch { return false; }
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputPanelHeightRef = useRef(160);
  const [inputPanelHeight, setInputPanelHeight] = useState(160);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inputPanelHeightRef.current;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const containerH = containerRef.current?.getBoundingClientRect().height ?? 600;
      const next = Math.min(containerH * 0.5, Math.max(120, startH + delta));
      inputPanelHeightRef.current = next;
      setInputPanelHeight(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const isAIBusy = aiJob.state.status === "starting" || aiJob.state.status === "running";

  const persistedJobIdRef = useRef<string | null>(null);
  const lastJobEntryIdsRef = useRef<{ jobId: string; userId: string | null; assistantId: string | null } | null>(null);

  const handleStartJob = useCallback(async () => {
    if (isAIBusy || isStreaming) return;
    try { await onFlushPendingSave(); } catch { /* logged */ }
    const r = await aiJob.start("next_reference_episode");
    if (!r.ok) setError(r.error ?? "Could not start AI job.");
  }, [aiJob, isAIBusy, isStreaming, onFlushPendingSave]);

  const handleApplyJob = useCallback(async () => {
    if (aiJob.state.status !== "completed" || !aiJob.state.output) return;
    if (!aiJob.state.kind || !aiJob.state.originTabId) return;
    const mode = applyModeForKind(aiJob.state.kind);
    const result = await onApplyToTab(
      aiJob.state.originTabId,
      aiJob.state.output,
      mode,
      { label: JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind }
    );
    if (!result.ok) {
      setError(result.reason === "target_tab_missing"
        ? "Couldn't apply — target tab missing. Copy from chat manually."
        : `Apply failed (${result.reason ?? "unknown"}).`);
      return;
    }
    if (result.fellBack) setError("Original tab missing; output landed in Workbook instead.");
    aiJob.reset();
  }, [aiJob, onApplyToTab]);

  const handleDiscardJob = useCallback(() => {
    const tracked = lastJobEntryIdsRef.current;
    if (tracked && tracked.jobId === aiJob.state.jobId) {
      const { userId, assistantId } = tracked;
      setHistory((prev) => prev.filter((e) => {
        if (e.type !== "message" || !e.id) return true;
        return e.id !== userId && e.id !== assistantId;
      }));
      if (userId) fetch(`/api/ai/chat-history?id=${userId}`, { method: "DELETE" }).catch(() => {});
      if (assistantId) fetch(`/api/ai/chat-history?id=${assistantId}`, { method: "DELETE" }).catch(() => {});
      lastJobEntryIdsRef.current = null;
    }
    aiJob.reset();
  }, [aiJob]);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setMessages([]);
    setStreamingText("");
    setError(null);
    fetch(`/api/ai/chat-history?documentId=${documentId}`, { method: "DELETE" }).catch(() => {});
  }, [documentId]);

  const persistEntry = useCallback(
    async (entry: HistoryEntry): Promise<string | null> => {
      try {
        const res = await fetch("/api/ai/chat-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId,
            entryType: entry.type === "mode-change" ? "mode-change" : "message",
            role: entry.type === "message" ? entry.role : null,
            content: entry.type === "message" ? entry.content : null,
            mode: entry.mode,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { id?: string };
        return data.id ?? null;
      } catch {
        return null;
      }
    },
    [documentId]
  );

  // Persist completed job output to chat history once per jobId
  useEffect(() => {
    if (aiJob.state.status !== "completed") return;
    if (!aiJob.state.jobId || !aiJob.state.kind || !aiJob.state.output) return;
    if (persistedJobIdRef.current === aiJob.state.jobId) return;
    persistedJobIdRef.current = aiJob.state.jobId;
    const jobId = aiJob.state.jobId;
    const label = JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind;
    const userEntry: HistoryEntry = { type: "message", role: "user", content: label, mode: "chat" };
    const assistantEntry: HistoryEntry = { type: "message", role: "assistant", content: aiJob.state.output, mode: "chat" };
    (async () => {
      const userId = await persistEntry(userEntry);
      const assistantId = await persistEntry(assistantEntry);
      lastJobEntryIdsRef.current = { jobId, userId, assistantId };
      setHistory((prev) => [
        ...prev,
        { ...userEntry, id: userId ?? undefined },
        { ...assistantEntry, id: assistantId ?? undefined },
      ]);
    })();
  }, [aiJob.state.status, aiJob.state.jobId, aiJob.state.kind, aiJob.state.output, persistEntry]);

  // Load history on mount
  useEffect(() => {
    fetch(`/api/ai/chat-history?documentId=${documentId}`)
      .then((r) => r.json())
      .then((entries: { id: string; entryType: string; role: string | null; content: string | null; mode: string; createdAt: string }[]) => {
        if (!Array.isArray(entries)) return;
        const loaded: HistoryEntry[] = entries.map((e) =>
          e.entryType === "mode-change"
            ? { type: "mode-change" as const, id: e.id, mode: e.mode as Mode, timestamp: new Date(e.createdAt).getTime() }
            : { type: "message" as const, id: e.id, role: e.role as "user" | "assistant", content: e.content || "", mode: e.mode as Mode }
        );
        setHistory(loaded);
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [documentId]);

  useEffect(() => {
    if (historyLoaded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [historyLoaded]);

  useEffect(() => {
    onSetModel("gemini-3.1-pro-preview");
    onSetThinking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming, streamingText]);

  const sendMessages = useCallback(
    async (
      msgs: ChatMessage[],
      opts: { selectionAtSubmit: boolean; originTabId: string; modeOverride?: Mode }
    ) => {
      const { modeOverride } = opts;
      const effectiveMode: Mode = modeOverride ?? mode;

      console.debug("[pipeline:send]", { effectiveMode, override: modeOverride ?? null });

      setIsStreaming(true);
      setStreamingText("");
      setError(null);

      try {
        const res = await fetch("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: msgs, mode: effectiveMode, modelId, thinking }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "AI request failed");
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            accumulated += chunk;
            setStreamingText(accumulated.replace(/^[012]\n/, ""));
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = { role: "assistant", content: accumulated };
              }
              return updated;
            });
          }
        }

        const cleanAccumulated = accumulated.replace(/^[012]\n/, "");
        if (cleanAccumulated) {
          const assistantEntry: HistoryEntry = {
            type: "message",
            role: "assistant",
            content: cleanAccumulated,
            mode: effectiveMode,
          };
          setHistory((prev) => [...prev, assistantEntry]);
          persistEntry(assistantEntry);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [mode, modelId, thinking, persistEntry]
  );

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;

    const originTabId = activeTab.id;
    const userContent = buildUserMessage(input);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const newMessages = [...messages, userMsg, assistantMsg];

    setMessages(newMessages);
    setInput("");

    const userEntry: HistoryEntry = { type: "message", role: "user", content: input, mode };
    setHistory((prev) => [...prev, userEntry]);
    persistEntry(userEntry);

    sendMessages(newMessages.filter((m) => m.content), {
      selectionAtSubmit: false,
      originTabId,
    });
  }, [input, isStreaming, messages, sendMessages, mode, activeTab, persistEntry]);

  function buildUserMessage(userInput: string): string {
    const liveContent = editorRef.current?.getContentJSON() ?? null;
    const contextBlock = buildAIContext({
      tabs,
      activeTab,
      activeTabLiveContent: liveContent,
      mode: "chat",
      selection: null,
      userMessage: userInput,
    });
    return `${contextBlock}\n\n## Message\n${userInput}`;
  }

  // ─── Pipeline step helpers ───

  const isTabNonEmpty = useCallback((tabType: string): boolean => {
    const t = tabs.find((tab) => tab.type === tabType);
    if (!t?.content) return false;
    const tagged = tiptapJsonToTagged(t.content);
    // Strip H1 stubs so an empty new tab (only "[H1] World State") reads as empty
    const withoutH1 = tagged
      .split("\n")
      .filter((line) => !line.trim().startsWith("[H1]"))
      .join("\n");
    return withoutH1.trim().length > 30;
  }, [tabs]);

  const handleStepClick = useCallback(
    async (stepId: PipelineStepId) => {
      if (isStreaming) return;

      // Always confirm before running a pipeline step — it clears chat history
      // so the agent starts fresh with the right context.
      const stepLabel = PIPELINE_STEPS.find((s) => s.id === stepId)?.label ?? stepId;
      if (history.length > 0 || messages.length > 0) {
        const confirmed = window.confirm(
          `Run "${stepLabel}"?\n\nThis will clear the current chat history and start fresh.`
        );
        if (!confirmed) return;
      }

      // Clear history (local state + server)
      setHistory([]);
      setMessages([]);
      setStreamingText("");
      setError(null);
      fetch(`/api/ai/chat-history?documentId=${documentId}`, { method: "DELETE" }).catch(() => {});

      setActiveStep(stepId);

      const liveWorkbookContent =
        activeTab.type === "workbook"
          ? (editorRef.current?.getContentJSON?.() ?? null)
          : null;

      const context = buildPipelineStepContext(stepId, tabs, liveWorkbookContent);

      console.debug("[pipeline:step]", {
        stepId,
        activeTabType: activeTab.type,
        usedLiveWorkbook: liveWorkbookContent !== null,
        contextChars: context.length,
      });

      const initialMessage: ChatMessage = {
        role: "user",
        content: context || "(no context available for this step yet)",
      };
      setMessages([initialMessage, { role: "assistant", content: "" }]);

      await sendMessages([initialMessage], {
        selectionAtSubmit: false,
        originTabId: activeTab.id,
        modeOverride: stepId,
      });
    },
    [isStreaming, history, messages, documentId, activeTab, editorRef, tabs, sendMessages]
  );

  const handleExitStep = useCallback(() => {
    setActiveStep(null);
    setMessages([]);
  }, []);

  // ─── Render ───

  return (
    <div ref={containerRef} className="flex h-full flex-col">

      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-4 py-2.5">
        <div>
          <h3 className="font-semibold text-indigo-700 leading-tight">AI Assistant</h3>
          {activeStep && (
            <p className="text-[10px] text-indigo-500 leading-tight">
              {MODE_LABELS[activeStep]}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (history.length === 0) return;
              if (window.confirm("Clear all chat history for this document? This cannot be undone.")) {
                handleClearHistory();
              }
            }}
            disabled={history.length === 0 || isStreaming}
            title="Clear chat history"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            &times;
          </button>
        </div>
      </div>

      {/* ─── Actions (pipeline steps) — compact 2×2 grid ─── */}
      <div className="flex-shrink-0 border-b border-gray-200 px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Actions</span>
          {activeStep && (
            <button
              type="button"
              onClick={handleExitStep}
              className="text-[10px] text-indigo-500 hover:text-indigo-700"
            >
              Exit
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {PIPELINE_STEPS.map((step) => {
            const tabFilled = isTabNonEmpty(step.enabledWhenTabType);
            const enabled = tabFilled && !isStreaming && !isAIBusy;
            const isActive = activeStep === step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => handleStepClick(step.id)}
                disabled={!enabled}
                title={!tabFilled ? `Fill ${step.requiredTabLabel} tab first` : undefined}
                className={`rounded px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors
                  ${isActive
                    ? "bg-indigo-600 text-white"
                    : enabled
                    ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
              >
                <span className="block">{step.label}</span>
                {!tabFilled && (
                  <span className="block text-[9px] font-normal text-gray-400 leading-tight mt-0.5">
                    Fill {step.requiredTabLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Pre-defined episode creator — separate from the pipeline steps */}
        <div className="mt-1.5 border-t border-gray-100 pt-1.5">
          <button
            type="button"
            onClick={handleStartJob}
            disabled={isStreaming || isAIBusy}
            className="w-full rounded px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {isAIBusy ? "Generating…" : "Create Pre-defined Episode"}
          </button>
        </div>
      </div>

      {/* ─── Messages / Streaming — takes all remaining space ─── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">

        {/* Empty state */}
        {history.length === 0 && messages.length === 0 && !isStreaming && (
          <div className="py-8 text-center text-[13px] text-gray-400">
            {"Click an action above to start, or type a prompt below."}
          </div>
        )}

        {/* Full history */}
        {history.map((entry, i) => {
          if (entry.type === "mode-change") {
            return (
              <div key={`mc-${i}`} className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-orange-300" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 whitespace-nowrap">
                  {MODE_LABELS[entry.mode]}
                </span>
                <div className="flex-1 h-px bg-orange-300" />
              </div>
            );
          }
          return (
            <div
              key={`h-${i}`}
              className={entry.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  entry.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-gray-200 text-gray-800"
                }`}
              >
                {entry.role === "assistant" ? (
                  <AssistantMessage content={entry.content} mode={entry.mode} isStreaming={false} />
                ) : (
                  <div className="whitespace-pre-wrap">{entry.content}</div>
                )}
              </div>
            </div>
          );
        })}

        {/* Active aiJob (Create Pre-defined Episode) */}
        {aiJob.state.status !== "idle" && (
          <>
            {aiJob.state.kind && (
              <div className="flex justify-end">
                <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-indigo-600 text-white">
                  {JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind}
                </div>
              </div>
            )}
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-white border border-indigo-200 text-gray-800 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                  <span className="text-indigo-700">{aiJob.state.kind ? (JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind) : "AI"}</span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700 normal-case capitalize">
                    {aiJob.state.status}
                  </span>
                </div>
                {aiJob.state.error && (
                  <div className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{aiJob.state.error}</div>
                )}
                {aiJob.state.output && (
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-gray-800">
                    {stripTagsForDisplay(aiJob.state.output)}
                  </pre>
                )}
                {(aiJob.state.status === "starting" || aiJob.state.status === "running") && !aiJob.state.output && (
                  <div className="flex items-center gap-2 text-xs text-indigo-600">
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                    Generating
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {(aiJob.state.status === "starting" || aiJob.state.status === "running") && (
                    <button onClick={aiJob.cancel} className="flex-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                      Cancel
                    </button>
                  )}
                  {aiJob.state.status === "completed" && aiJob.state.output && (
                    <>
                      <button onClick={handleDiscardJob} className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                        Discard
                      </button>
                      <button onClick={handleApplyJob} className="flex-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700">
                        Append to Workbook
                      </button>
                    </>
                  )}
                  {(aiJob.state.status === "failed" || aiJob.state.status === "cancelled") && (
                    <button onClick={aiJob.reset} className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Live streaming output */}
        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-white border border-gray-200 text-gray-800">
              <AssistantMessage content={streamingText} mode={mode} isStreaming={true} />
            </div>
          </div>
        )}

        {/* Waiting indicator */}
        {isStreaming && !streamingText && (
          <div className="flex items-center gap-2 py-2 text-indigo-600">
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* ─── Drag handle ─── */}
      <div
        onMouseDown={handleResizeStart}
        className="group flex h-2.5 flex-shrink-0 cursor-ns-resize items-center justify-center bg-gray-100 hover:bg-indigo-100 transition-colors select-none"
        title="Drag to resize"
      >
        <div className="h-0.5 w-8 rounded-full bg-gray-300 group-hover:bg-indigo-400 transition-colors" />
      </div>

      {/* ─── Input panel ─── */}
      <div
        style={{ height: inputPanelHeight }}
        className="flex flex-shrink-0 flex-col border-t border-gray-200 px-3 pt-2 pb-2 gap-2 overflow-hidden"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What would you like to do?"
          disabled={isStreaming}
          className={`min-h-0 flex-1 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none transition-colors ${
            isStreaming
              ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
              : "border-gray-300 bg-white"
          }`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (sendOnEnter && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                handleSubmit();
              } else if (!sendOnEnter && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isStreaming || !input.trim()}
          className="w-full flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {isStreaming ? "Generating..." : "Send"}
        </button>
        <div className="flex flex-shrink-0 justify-center">
          <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => { setSendOnEnter(false); localStorage.setItem("ai-send-on-enter", "false"); }}
              className={`px-3 py-1 transition-colors ${!sendOnEnter ? "bg-green-100 text-green-700 font-medium" : "bg-white text-gray-400 hover:text-gray-500"}`}
            >
              ⌘+Enter
            </button>
            <button
              onClick={() => { setSendOnEnter(true); localStorage.setItem("ai-send-on-enter", "true"); }}
              className={`px-3 py-1 transition-colors border-l border-gray-200 ${sendOnEnter ? "bg-green-100 text-green-700 font-medium" : "bg-white text-gray-400 hover:text-gray-500"}`}
            >
              Enter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Assistant message renderer ───

function AssistantMessage({
  content,
  mode,
  isStreaming,
}: {
  content: string;
  mode: Mode;
  isStreaming: boolean;
}) {
  void mode;
  let displayContent = content;
  if (content.startsWith("[CLARIFY]")) {
    displayContent = content.replace(/^\[CLARIFY\]\s*/, "");
  } else if (/^\[(?:H\d|OL|UL|P)]/m.test(content) || content.includes("[CHANGE")) {
    displayContent = stripTagsForDisplay(content);
  }
  if (!displayContent) return null;
  return (
    <div className="whitespace-pre-wrap">
      {displayContent}
      {isStreaming && (
        <span className="inline-block ml-1 h-3 w-1.5 bg-indigo-500 animate-pulse" />
      )}
    </div>
  );
}
