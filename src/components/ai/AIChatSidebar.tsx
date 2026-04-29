"use client";

import { useState, useRef, useEffect, useCallback, RefObject } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import type { EditorHandle } from "@/components/editor/Editor";
import { buildAIContext } from "@/lib/ai/context-engine";
import WorkbookActions, {
  WORKBOOK_ACTION_LABELS,
} from "@/components/ai/WorkbookActions";
import type { useJob, JobKind } from "@/lib/ai/useJob";
import type { ApplyToTabResult } from "@/app/doc/[id]/page";

type AIJobController = ReturnType<typeof useJob>;

// Apply mode for a finished job's output. Format Document replaces the tab
// body wholesale; the workbook actions append their output to the workbook.
function applyModeForKind(kind: JobKind): "replace" | "append" {
  return kind === "format_tab" ? "replace" : "append";
}

// ─── Types ───

type Mode = "edit" | "draft" | "feedback" | "format" | "chat";

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
};

// All legacy quick-action buttons have been removed (per writer feedback —
// too many options were confusing). Workbook gets durable server-side
// actions via WorkbookActions; other tabs get the free-form chat input.
// Note: the previous "Generate Adaptation State" workbook quick-action has
// been replaced by the WorkbookActions panel (durable, server-side jobs).

interface ParsedChange {
  id: number;
  location: string;
  original: string;
  suggested: string;
}

function aiJobStatusLabel(s: string): string {
  if (s === "starting") return "Starting…";
  if (s === "running") return "Generating…";
  if (s === "completed") return "Done";
  if (s === "failed") return "Failed";
  if (s === "cancelled") return "Cancelled";
  return s;
}

function stripTagsForDisplay(text: string): string {
  return text
    .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")
    .split("\n")
    .map((l) => l.replace(/^\[(?:H\d|OL|UL|P|HR)\]\s*/, ""))
    .filter((l) => l.trim())
    .join("\n");
}

function parseChanges(text: string): ParsedChange[] | null {
  const changeBlocks = text.split(/\[CHANGE \d+\]/i).slice(1);
  if (changeBlocks.length === 0) return null;

  return changeBlocks
    .map((block, i) => {
      const location =
        block.match(/Location:\s*"?([^"\n]+)"?/i)?.[1]?.trim() || "";
      const original =
        block.match(/Original:\s*([\s\S]*?)(?=\nSuggested:|$)/i)?.[1]?.trim() ||
        "";
      const suggested =
        block.match(/Suggested:\s*([\s\S]*?)$/i)?.[1]?.trim() || "";
      return { id: i + 1, location, original, suggested };
    })
    .filter((c) => c.suggested);
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
  // Durable workbook-action job. Owned by the doc page so it survives
  // sidebar open/close. The sidebar reads state, dispatches start/cancel/
  // reset through the controller.
  aiJob: AIJobController;
  // Routes tagged content to the origin tab. Same-tab uses the live editor;
  // cross-tab uses the tab-content PUT endpoint. Falls back to workbook if
  // the origin tab no longer exists.
  onApplyToTab: (
    originTabId: string,
    content: string,
    mode: "replace" | "append"
  ) => Promise<ApplyToTabResult>;
  onApplyChange: (original: string, suggested: string) => void;
  onFlushPendingSave: () => Promise<void>;
  onSetModel: (modelId: string) => void;
  onSetThinking: (enabled: boolean) => void;
  onSetTitle: (title: string) => void;
  onClose: () => void;
}

export default function AIChatSidebar({
  documentId,
  aiJob,
  tabs,
  activeTab,
  editorRef,
  editorIsEmpty,
  modelId,
  thinking,
  onApplyToTab,
  onApplyChange,
  onFlushPendingSave,
  onSetModel,
  onSetThinking,
  onSetTitle,
  onClose,
}: AIChatSidebarProps) {
  // Selection-based "Edit with AI" was removed (Bug 4 fix, 29 Apr 2026).
  // The sidebar now always operates in chat mode for free-form prompts;
  // Format Document and the workbook actions handle their own job pipelines.
  const mode: Mode = "chat";

  // messages = current AI conversation context (reset per mode change)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // history = full display history (persisted to server, survives refresh)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ParsedChange[] | null>(null);
  const [feedbackApplied, setFeedbackApplied] = useState(false);
  const [reviewMode, setReviewMode] = useState<"bulk" | "stepwise" | null>(null);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [skipWarning, setSkipWarning] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    try { return localStorage.getItem("ai-send-on-enter") === "true"; } catch { return false; }
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevModeRef = useRef<Mode | null>(null);

  // ─── Durable AI job — owned by the doc page (passed in as a prop)
  // so it survives AI-sidebar open/close. The hook's EventSource keeps
  // streaming tokens even when this component unmounts; reopening the
  // sidebar shows whatever progress accumulated in the meantime.
  const isAIBusy =
    aiJob.state.status === "starting" || aiJob.state.status === "running";

  const handleStartJob = useCallback(
    async (kind: JobKind) => {
      if (isAIBusy || isStreaming) return;
      // Format Document reads the tab fresh from DB at job-run time. Without
      // a flush, recent typing that's still in the autosave debounce window
      // is invisible to the LLM. Flush is a no-op for kinds that don't read
      // the active tab (workbook actions read other tabs), so we always
      // flush — costs a few ms, simplifies the code path.
      try {
        await onFlushPendingSave();
      } catch {
        /* logged via client-trace */
      }
      const r = await aiJob.start(kind);
      if (!r.ok) {
        setError(r.error ?? "Could not start AI job.");
      }
    },
    [aiJob, isAIBusy, isStreaming, onFlushPendingSave]
  );

  // Apply the most recent completed job's output to its origin tab. Routing
  // (same-tab vs cross-tab vs fallback) is handled by onApplyToTab on the
  // doc page; this callback just dispatches with the right mode for the
  // job kind. Result.fellBack === true means the origin tab was deleted
  // mid-job and we landed on workbook instead — surface that to the writer.
  const handleApplyJob = useCallback(async () => {
    if (aiJob.state.status !== "completed" || !aiJob.state.output) return;
    if (!aiJob.state.kind || !aiJob.state.originTabId) return;

    const mode = applyModeForKind(aiJob.state.kind);
    const result = await onApplyToTab(
      aiJob.state.originTabId,
      aiJob.state.output,
      mode
    );
    if (!result.ok) {
      if (result.reason === "target_tab_missing") {
        setError(
          "Couldn't apply — the original tab no longer exists and there's no workbook to fall back to. The output is still in chat; copy it manually."
        );
      } else {
        setError(`Apply failed (${result.reason ?? "unknown"}). Try again.`);
      }
      return;
    }
    if (result.fellBack) {
      setError(
        "Original tab no longer exists; output landed in the Workbook instead."
      );
    }
    aiJob.reset();
  }, [aiJob, onApplyToTab]);

  const persistedJobIdRef = useRef<string | null>(null);
  // Tracks the rows persisted for the most recent completed job — so Discard
  // (which fires on the same jobId) can delete the same rows it just wrote.
  // Reset to null whenever a new job starts, or after deletion.
  const lastJobEntryIdsRef = useRef<{
    jobId: string;
    userId: string | null;
    assistantId: string | null;
  } | null>(null);

  // Discard the active completed job AND remove its persisted entries from
  // chat history. The persist effect captures both row IDs into
  // lastJobEntryIdsRef so we can target them precisely. Filter local state
  // first (instant UX), then fire DELETEs (best-effort).
  const handleDiscardJob = useCallback(() => {
    const tracked = lastJobEntryIdsRef.current;
    if (tracked && tracked.jobId === aiJob.state.jobId) {
      const { userId, assistantId } = tracked;
      setHistory((prev) =>
        prev.filter((e) => {
          if (e.type !== "message" || !e.id) return true;
          return e.id !== userId && e.id !== assistantId;
        })
      );
      if (userId) {
        fetch(`/api/ai/chat-history?id=${userId}`, { method: "DELETE" }).catch(
          () => {}
        );
      }
      if (assistantId) {
        fetch(`/api/ai/chat-history?id=${assistantId}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      lastJobEntryIdsRef.current = null;
    }
    aiJob.reset();
  }, [aiJob]);

  // Clear the entire chat history for this document. Confirmation handled
  // by the caller (window.confirm in the header button). Local state is
  // cleared instantly; server DELETE is best-effort.
  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setMessages([]);
    setStreamingText("");
    setError(null);
    lastJobEntryIdsRef.current = null;
    fetch(`/api/ai/chat-history?documentId=${documentId}`, {
      method: "DELETE",
    }).catch(() => {});
  }, [documentId]);

  // Persist a history entry to the server. Returns the row id on success
  // (so callers that need to delete the row later — e.g. Discard — can
  // remember it). Failures resolve to null; they're non-fatal.
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

  // Persist completed workbook-action results to chat history. Fires once per
  // jobId on the running→completed transition. Both the user-trigger label and
  // the assistant output are recorded as `mode: "chat"` entries so they land
  // alongside regular chat messages and survive reload, Discard, or Append.
  // (Decision 28 Apr: option (b) — all outputs persist; Discard then deletes.)
  // Captures the persisted row IDs into lastJobEntryIdsRef so Discard can
  // remove the same rows from chat history that this effect just wrote.
  useEffect(() => {
    if (aiJob.state.status !== "completed") return;
    if (!aiJob.state.jobId || !aiJob.state.kind || !aiJob.state.output) return;
    if (persistedJobIdRef.current === aiJob.state.jobId) return;
    persistedJobIdRef.current = aiJob.state.jobId;

    const jobId = aiJob.state.jobId;
    const userEntry: HistoryEntry = {
      type: "message",
      role: "user",
      content: WORKBOOK_ACTION_LABELS[aiJob.state.kind],
      mode: "chat",
    };
    const assistantEntry: HistoryEntry = {
      type: "message",
      role: "assistant",
      content: aiJob.state.output,
      mode: "chat",
    };

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

  // Load history from server on mount
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

  // Scroll to bottom after history loads
  useEffect(() => {
    if (historyLoaded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [historyLoaded]);

  // Initial mount: pick the default model. With selection-based edit mode
  // removed, there are no mode flips to react to anymore — chat is the only
  // mode the sidebar ever runs in.
  useEffect(() => {
    onSetModel("gemini-3.1-pro-preview");
    onSetThinking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const sendMessages = useCallback(
    async (
      msgs: ChatMessage[],
      opts: { selectionAtSubmit: boolean; originTabId: string }
    ) => {
      const { selectionAtSubmit, originTabId } = opts;
      setIsStreaming(true);
      setStreamingText("");
      setError(null);

      try {
        const res = await fetch("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs,
            mode,
            modelId,
            thinking,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "AI request failed");
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        // Chat mode: first-line signal. 0 = full doc, 1 = conversation, 2 = targeted changes.
        let chatSignal: "0" | "1" | "2" | null = null;
        let chatShowPlaceholder = false;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            accumulated += chunk;

            // In chat mode, detect the signal from the first line
            if (mode === "chat" && chatSignal === null && accumulated.includes("\n")) {
              const firstLine = accumulated.split("\n")[0].trim();
              if (firstLine === "0") {
                chatSignal = "0";
                chatShowPlaceholder = true;
                setMessages((prev) => {
                  const lastUser = [...prev].reverse().find((m) => m.role === "user");
                  return [
                    ...(lastUser ? [lastUser] : []),
                    { role: "assistant", content: "Writing to document..." },
                  ];
                });
              } else if (firstLine === "1") {
                chatSignal = "1";
              } else if (firstLine === "2") {
                chatSignal = "2";
                chatShowPlaceholder = true;
                setMessages((prev) => {
                  const lastUser = [...prev].reverse().find((m) => m.role === "user");
                  return [
                    ...(lastUser ? [lastUser] : []),
                    { role: "assistant", content: "Generating changes..." },
                  ];
                });
              }
            }

            // Update streaming display text (skip when showing a placeholder)
            if (!chatShowPlaceholder) {
              const displayContent =
                mode === "chat" && chatSignal === "1"
                  ? accumulated.replace(/^1\n/, "")
                  : accumulated;
              setStreamingText(displayContent);
            }

            // Also update messages for AI context (not rendered directly)
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

        // Strip the signal line from accumulated content
        let cleanAccumulated = accumulated;
        if (mode === "chat" && chatSignal !== null) {
          cleanAccumulated = accumulated.replace(/^[012]\n/, "");
        }

        // Chat mode with signal 0: apply full document to the ORIGIN tab
        // (the tab active when the user pressed Send), not whatever tab
        // they may have switched to mid-stream. Cross-tab routing is
        // delegated to onApplyToTab on the doc page.
        //
        // Selection guard: when the writer had text selected at submit
        // time, the AI was reasoning about that selection and any "write
        // the whole document" reply almost always means something the
        // writer doesn't want auto-applied. Output stays in chat; writer
        // copies anything they want manually. This is the explicit Bug 4
        // fix — auto-apply on selection drifted unpredictably.
        if (mode === "chat" && chatSignal === "0") {
          if (selectionAtSubmit) {
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = { role: "assistant", content: cleanAccumulated };
              }
              return updated;
            });
          } else {
            await onApplyToTab(originTabId, cleanAccumulated, "replace");

            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = { role: "assistant", content: "Document has been written." };
              }
              return updated;
            });

            const h1Match = cleanAccumulated.match(/^\[H1\]\s+(.+)/m);
            const title = h1Match ? h1Match[1] : "";
            if (title) onSetTitle(title);
          }
        }

        // Chat mode with signal 2: parse targeted changes into change cards.
        // Same selection guard as signal 0 — when the writer had a selection
        // at submit time, suppress the [CHANGE] card UI and just show the
        // raw response in chat.
        if (mode === "chat" && chatSignal === "2") {
          if (!selectionAtSubmit) {
            const parsed = parseChanges(cleanAccumulated);
            if (parsed && parsed.length > 0) {
              setChanges(parsed);
            }
          }
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
              updated[lastIdx] = { role: "assistant", content: cleanAccumulated };
            }
            return updated;
          });
        }

        // Use clean content for everything below
        accumulated = cleanAccumulated;

        // Persist assistant response to history
        if (accumulated) {
          const historyContent =
            mode === "chat" && chatSignal === "0"
              ? "Document has been written."
              : accumulated;
          const assistantEntry: HistoryEntry = {
            type: "message",
            role: "assistant",
            content: historyContent,
            mode,
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
    [mode, modelId, thinking, onApplyToTab, onSetTitle]
  );

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    // Snapshot the apply context at SEND time. The active tab can shift
    // while the LLM streams; the apply target is the tab the writer was
    // looking at when they hit Send. selectionAtSubmit is preserved as a
    // dormant guard — selection-based edit mode was removed (Bug 4 fix),
    // so this is always false today; left in place so a future re-enable
    // of selection-aware AI inherits the auto-apply suppression.
    const selectionAtSubmit = false;
    const originTabId = activeTab.id;

    const userContent = buildUserMessage(input);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    // Empty placeholder — rendered as "Thinking..." in the UI but NOT sent to AI
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput("");
    setFeedbackApplied(false);

    // Add user message to display history and persist
    const userEntry: HistoryEntry = {
      type: "message",
      role: "user",
      content: input,
      mode,
    };
    setHistory((prev) => [...prev, userEntry]);
    persistEntry(userEntry);

    // Send all messages — filter out the empty placeholder so it's not sent to AI
    sendMessages(newMessages.filter((m) => m.content), {
      selectionAtSubmit,
      originTabId,
    });
  }, [input, isStreaming, messages, sendMessages, mode, activeTab]);

  function buildUserMessage(userInput: string): string {
    const liveContent = editorRef.current?.getContentJSON() ?? null;
    const contextBlock = buildAIContext({
      tabs,
      activeTab,
      activeTabLiveContent: liveContent,
      mode: "chat",
      selection: null,
    });
    return `${contextBlock}\n\n## Message\n${userInput}`;
  }

  // ─── Apply handlers ───
  const handleApplyAllChanges = async () => {
    if (!changes) return;
    // Apply all changes in reverse order (so earlier positions aren't shifted)
    const all = [...changes].reverse();
    for (const c of all) {
      onApplyChange(c.original, c.suggested);
      await new Promise((r) => setTimeout(r, 50));
    }
    setFeedbackApplied(true);
  };

  const handleRejectAllChanges = () => {
    setChanges(null);
  };

  // Format Document used to stream in-component via /api/ai/edit and write
  // back through editorRef on completion — which silently targeted whatever
  // tab the writer was viewing when the stream ended (Bug 1). Now it goes
  // through the durable ai_jobs pipeline like the workbook actions: origin
  // tab is captured server-side, the apply step routes via onApplyToTab.
  const handleStartFormatTab = useCallback(() => {
    void handleStartJob("format_tab");
  }, [handleStartJob]);

  // Reset review state whenever a new set of changes arrives
  useEffect(() => {
    setReviewMode(null);
    setCurrentChangeIndex(0);
    setSkipWarning(false);
  }, [changes]);

  const handleAcceptStepChange = () => {
    if (!changes) return;
    onApplyChange(changes[currentChangeIndex].original, changes[currentChangeIndex].suggested);
    if (currentChangeIndex + 1 >= changes.length) {
      setFeedbackApplied(true);
    } else {
      setCurrentChangeIndex((prev) => prev + 1);
      setSkipWarning(false);
    }
  };

  const handleSkipStepChange = () => {
    if (!changes) return;
    const remaining = changes.length - currentChangeIndex - 1;
    if (remaining > 0 && !skipWarning) {
      setSkipWarning(true);
      return;
    }
    setFeedbackApplied(true);
  };

  // ─── Render helpers ───

  const modeLabel = "Chat";

  const placeholder =
    "What would you like to do? (e.g. 'add an episode', 'tighten dialogue in ep 3')";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h3 className="font-semibold text-indigo-700">AI Assistant</h3>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">
            {modeLabel}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!editorIsEmpty && activeTab.type !== "workbook" && (
            <button
              onClick={handleStartFormatTab}
              disabled={isStreaming || isAIBusy}
              title="Restructure this tab to its canonical format"
              className="rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Format
            </button>
          )}
          <button
            onClick={() => {
              if (history.length === 0) return;
              if (window.confirm("Clear all chat history for this document? This cannot be undone.")) {
                handleClearHistory();
              }
            }}
            disabled={history.length === 0 || isAIBusy || isStreaming}
            title="Clear chat history"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Workbook action buttons — only visible when on workbook tab.
          Job state lives in this parent component so the active-job UI
          (rendered inline in the chat thread below) stays alive across
          tab switches. */}
      {activeTab.type === "workbook" && (
        <WorkbookActions isAIBusy={isAIBusy} onStart={handleStartJob} />
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Empty state */}
        {history.length === 0 && messages.length === 0 && !isStreaming && (
          <div className="py-6 text-sm text-gray-500">
            <p className="text-center text-gray-400">
              {activeTab.type === "workbook"
                ? "Use a workbook action above, or type your own prompt below."
                : "Type your prompt below."}
            </p>
          </div>
        )}

        {/* Full history (persisted across mode changes) */}
        {history.map((entry, i) => {
          if (entry.type === "mode-change") {
            return (
              <div key={`mc-${i}`} className="flex items-center gap-2 py-2">
                <div className="flex-1 h-px bg-orange-300" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 whitespace-nowrap">
                  {MODE_LABELS[entry.mode]}
                </span>
                <div className="flex-1 h-px bg-orange-300" />
              </div>
            );
          }
          // Message entry
          return (
            <div
              key={`h-${i}`}
              className={
                entry.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  entry.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-gray-200 text-gray-800"
                }`}
              >
                {entry.role === "assistant" ? (
                  <AssistantMessage
                    content={entry.content}
                    mode={entry.mode}
                    isLast={false}
                    isStreaming={false}
                  />
                ) : (
                  <div className="whitespace-pre-wrap">{entry.content}</div>
                )}
              </div>
            </div>
          );
        })}

        {/* Active AI job (Plot Chunks / Next Episode Plot / Next Reference
            Episode). Renders as a chat-style message pair so the visual
            language matches the regular chat flow. Survives tab switches
            because the hook lives at the parent (AIChatSidebar) level. */}
        {aiJob.state.status !== "idle" && (
          <>
            {aiJob.state.kind && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-indigo-600 text-white">
                  {WORKBOOK_ACTION_LABELS[aiJob.state.kind]}
                </div>
              </div>
            )}
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-white border border-indigo-200 text-gray-800 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                  <span className="text-indigo-700">
                    {aiJob.state.kind ? WORKBOOK_ACTION_LABELS[aiJob.state.kind] : "AI"}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700 normal-case">
                    {aiJobStatusLabel(aiJob.state.status)}
                  </span>
                </div>

                {aiJob.state.error && (
                  <div className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 normal-case">
                    {aiJob.state.error}
                  </div>
                )}

                {aiJob.state.output && (
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-gray-800">
                    {/* Strip structural tags ([H1] [P] [UL] etc.) for display
                        only. The raw tagged text is preserved in
                        aiJob.state.output for Append-to-workbook so the
                        editor can re-parse the structure. */}
                    {stripTagsForDisplay(aiJob.state.output)}
                  </pre>
                )}

                {(aiJob.state.status === "starting" ||
                  aiJob.state.status === "running") &&
                  !aiJob.state.output && (
                    <div className="flex items-center gap-2 text-xs text-indigo-600 normal-case">
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>
                      Generating
                    </div>
                  )}

                {/* Inline action buttons — match the visual rhythm of the
                    regular chat's Apply/Reject patterns */}
                <div className="flex gap-2 pt-1">
                  {(aiJob.state.status === "starting" ||
                    aiJob.state.status === "running") && (
                    <button
                      onClick={aiJob.cancel}
                      className="flex-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  )}
                  {aiJob.state.status === "completed" && aiJob.state.output && (
                    <>
                      <button
                        onClick={handleDiscardJob}
                        className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Discard
                      </button>
                      <button
                        onClick={handleApplyJob}
                        className="flex-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        {(() => {
                          // Build a label that names the origin tab and the
                          // mode: "Apply to Microdrama Plots" (replace) vs
                          // "Append to Workbook" (workbook actions).
                          const kind = aiJob.state.kind;
                          const origin = aiJob.state.originTabId
                            ? tabs.find((t) => t.id === aiJob.state.originTabId)
                            : null;
                          const tabLabel = origin?.title ?? "Workbook";
                          const verb =
                            kind && applyModeForKind(kind) === "replace"
                              ? "Apply to"
                              : "Append to";
                          return `${verb} ${tabLabel}`;
                        })()}
                      </button>
                    </>
                  )}
                  {(aiJob.state.status === "failed" ||
                    aiJob.state.status === "cancelled") && (
                    <button
                      onClick={aiJob.reset}
                      className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Current streaming content */}
        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-white border border-gray-200 text-gray-800">
              <AssistantMessage
                content={streamingText}
                mode={mode}
                isLast={true}
                isStreaming={true}
              />
            </div>
          </div>
        )}

        {/* Waiting indicator (no streaming content yet) */}
        {isStreaming && !streamingText && (
          <div className="flex items-center gap-2 text-sm text-indigo-600 py-2">
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Chat: Review mode selector */}
        {changes && !isStreaming && !feedbackApplied && reviewMode === null && changes.length > 1 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3 mt-2">
            <p className="text-sm font-medium text-gray-700">
              {changes.length} changes ready. How would you like to review?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setReviewMode("stepwise")}
                className="flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
              >
                Episode by episode
              </button>
              <button
                onClick={() => setReviewMode("bulk")}
                className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                All at once
              </button>
            </div>
          </div>
        )}

        {/* Chat: Stepwise — one change at a time */}
        {changes && !isStreaming && !feedbackApplied && reviewMode === "stepwise" && (
          <div className="space-y-3 pt-2">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Change {currentChangeIndex + 1} of {changes.length}
            </p>
            <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase">
                {changes[currentChangeIndex].location && (
                  <span className="font-normal normal-case text-gray-400">
                    &ldquo;{changes[currentChangeIndex].location.slice(0, 60)}&rdquo;
                  </span>
                )}
              </p>
              {changes[currentChangeIndex].original && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-gray-700 whitespace-pre-wrap">
                  {changes[currentChangeIndex].original}
                </div>
              )}
              <div className="rounded border border-green-200 bg-green-50 p-2 text-xs text-gray-700 whitespace-pre-wrap">
                {stripTagsForDisplay(changes[currentChangeIndex].suggested)}
              </div>
            </div>
            {skipWarning && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {changes.length - currentChangeIndex - 1} remaining change(s) will be dropped. Click &ldquo;Drop rest&rdquo; to confirm.
              </div>
            )}
          </div>
        )}

        {/* Chat: Bulk — all changes at once */}
        {changes && !isStreaming && !feedbackApplied && (reviewMode === "bulk" || changes.length === 1) && (
          <div className="space-y-3 pt-2">
            {changes.map((change) => (
              <div
                key={change.id}
                className="rounded-lg border border-gray-200 bg-white p-3 space-y-2"
              >
                <p className="text-[10px] font-semibold text-gray-500 uppercase">
                  Change {change.id}
                  {change.location && (
                    <span className="ml-1 font-normal normal-case text-gray-400">
                      — &ldquo;{change.location.slice(0, 40)}...&rdquo;
                    </span>
                  )}
                </p>
                {change.original && (
                  <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-gray-700 whitespace-pre-wrap">
                    {change.original}
                  </div>
                )}
                <div className="rounded border border-green-200 bg-green-50 p-2 text-xs text-gray-700 whitespace-pre-wrap">
                  {stripTagsForDisplay(change.suggested)}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Sticky buttons: stepwise mode */}
      {changes && !feedbackApplied && !isStreaming && reviewMode === "stepwise" && (
        <div className="border-t border-gray-200 px-3 py-2 flex gap-2">
          <button
            onClick={handleSkipStepChange}
            className="flex-1 rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 transition-colors"
          >
            {skipWarning ? "Drop rest" : "Skip"}
          </button>
          <button
            onClick={handleAcceptStepChange}
            className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            Accept
          </button>
        </div>
      )}

      {/* Sticky buttons: bulk mode */}
      {changes && !feedbackApplied && !isStreaming && (reviewMode === "bulk" || changes.length === 1) && (
        <div className="border-t border-gray-200 px-3 py-2 flex gap-2">
          <button
            onClick={handleRejectAllChanges}
            className="flex-1 rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 transition-colors"
          >
            Reject all
          </button>
          <button
            onClick={handleApplyAllChanges}
            className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            Apply all ({changes.length})
          </button>
        </div>
      )}

      {/* Input — always visible, disabled during streaming or while a
          workbook job is running. Single-AI-lock: no chat sends while
          a Plot Chunks / Next Episode Plot / Next Reference Episode
          generation is in flight. */}
      <div className="border-t border-gray-200 p-3 space-y-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isAIBusy
                ? "AI is generating — wait for the current job to finish or cancel it."
                : placeholder
            }
            rows={3}
            disabled={isStreaming || isAIBusy}
            className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none transition-colors ${
              isStreaming || isAIBusy
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
            disabled={isStreaming || isAIBusy || !input.trim()}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {isStreaming ? "Generating..." : isAIBusy ? "AI busy" : "Send"}
          </button>
          <div className="flex justify-center">
            <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => { setSendOnEnter(false); localStorage.setItem("ai-send-on-enter", "false"); }}
                className={`px-3 py-1 transition-colors ${
                  !sendOnEnter
                    ? "bg-green-100 text-green-700 font-medium"
                    : "bg-white text-gray-400 hover:text-gray-500"
                }`}
              >
                ⌘+Enter
              </button>
              <button
                onClick={() => { setSendOnEnter(true); localStorage.setItem("ai-send-on-enter", "true"); }}
                className={`px-3 py-1 transition-colors border-l border-gray-200 ${
                  sendOnEnter
                    ? "bg-green-100 text-green-700 font-medium"
                    : "bg-white text-gray-400 hover:text-gray-500"
                }`}
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
  isLast,
  isStreaming,
}: {
  content: string;
  mode: Mode;
  isLast: boolean;
  isStreaming: boolean;
}) {
  // Strip special prefixes for display
  let displayContent = content;

  if (content.startsWith("[CLARIFY]")) {
    displayContent = content.replace(/^\[CLARIFY\]\s*/, "");
  } else if (!isLast && /^\[(?:H\d|OL|UL|P)]/m.test(content)) {
    // History entry — show clean content (tags stripped). Covers persisted
    // workbook-action results (chat mode) and the format_tab job's output.
    displayContent = stripTagsForDisplay(content);
  } else if (content.includes("[CHANGE")) {
    if (isLast) {
      // Current message — cards are shown below, hide raw text
      displayContent = "";
    } else {
      // History — show the actual suggested (applied) content
      const parsed = parseChanges(content);
      if (parsed && parsed.length > 0) {
        displayContent = parsed
          .map((c) => `Change ${c.id}:\n${stripTagsForDisplay(c.suggested)}`)
          .join("\n\n");
      } else {
        const changeCount = (content.match(/\[CHANGE \d+\]/gi) || []).length;
        displayContent = `Suggested ${changeCount} change${changeCount !== 1 ? "s" : ""} to the document.`;
      }
    }
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
