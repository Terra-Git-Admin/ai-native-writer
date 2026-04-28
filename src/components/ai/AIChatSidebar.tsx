"use client";

import { useState, useRef, useEffect, useCallback, RefObject } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import type { EditorHandle } from "@/components/editor/Editor";
import { buildAIContext, tiptapJsonToTagged } from "@/lib/ai/context-engine";
import WorkbookActions from "@/components/ai/WorkbookActions";

// ─── Types ───

type Mode = "edit" | "draft" | "feedback" | "format" | "chat";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type HistoryEntry =
  | { type: "mode-change"; mode: Mode; timestamp: number }
  | { type: "message"; role: "user" | "assistant"; content: string; mode: Mode };

const MODE_LABELS: Record<Mode, string> = {
  edit: "Edit Selection",
  draft: "Story Creation",
  feedback: "Document Feedback",
  format: "Format Document",
  chat: "Chat",
};

const IMPORT_CONVERT_ACTION = {
  label: "Import & convert this document",
  prompt:
    "Please read this document and convert it into the standard series format. Map each section to the correct heading (Series Overview, Characters, Episode Plots, Reference Episodes). Where content exists, convert it to the correct format. Where a section is missing or blank, leave it blank — do not invent anything. Preserve all research and original story material verbatim in a Research & Original Story section at the bottom.",
};

const CHAT_QUICK_ACTIONS_EMPTY = [
  {
    label: "Create a new story",
    prompt: "I want to create a new story. Help me get started.",
  },
  IMPORT_CONVERT_ACTION,
  {
    label: "Start from a story idea",
    prompt:
      "I have a story idea. Let me describe it and you can help me develop it into a full series.",
  },
];

const CHAT_QUICK_ACTIONS_EXISTING = [
  IMPORT_CONVERT_ACTION,
  {
    label: "Start episode plot adaptation",
    prompt:
      "Start episode plot adaptation. Please analyse the Research & Original Story section and begin.",
  },
  {
    label: "Add a reference episode",
    prompt:
      "I want to add a new reference episode. Help me write it in the correct format.",
  },
  {
    label: "Update the episode plots",
    prompt: "I want to review and update the episode plots section.",
  },
  {
    label: "Improve the dialogue",
    prompt: "Help me improve the dialogue across the episodes.",
  },
  {
    label: "Generate dialogue outline",
    prompt:
      "Generate a dialogue outline from all the reference episodes — extract every dialogue line, group by character voice, and build a relationship matrix showing how each pair of characters speak to each other.",
  },
  {
    label: "Check grammar",
    prompt:
      "Check grammar. Scan the entire document for spelling mistakes, grammar errors, and punctuation issues. Fix only objective errors — do not change any story content, vocabulary, or writing style.",
  },
];

// Note: the previous "Generate Adaptation State" workbook quick-action has
// been replaced by the WorkbookActions panel (durable, server-side jobs for
// Plot Chunks / Next Episode Plot / Next Reference Episode). The component
// renders at the top of the messages area whenever the active tab is
// workbook, so legacy quick-action buttons no longer ship here.

interface ParsedChange {
  id: number;
  location: string;
  original: string;
  suggested: string;
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
  selection: {
    text: string;
    taggedText: string;
    from: number;
    to: number;
    surroundingContext?: string;
  } | null;
  editorIsEmpty: boolean;
  modelId: string;
  thinking: boolean;
  onApplyEdit: (taggedAIResponse: string) => void;
  onRejectEdit: () => void;
  onApplyDraft: (content: string) => void;
  onApplyChange: (original: string, suggested: string) => void;
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
  selection,
  editorIsEmpty,
  modelId,
  thinking,
  onApplyEdit,
  onRejectEdit,
  onApplyDraft,
  onApplyChange,
  onSetModel,
  onSetThinking,
  onSetTitle,
  onClose,
}: AIChatSidebarProps) {
  // Edit selection mode temporarily disabled — pending use case definition.
  // To re-enable: flip editModeEnabled to true (or restore: selection ? "edit" : "chat")
  const editModeEnabled = false as boolean;
  const mode: Mode = editModeEnabled && selection ? "edit" : "chat";

  // messages = current AI conversation context (reset per mode change)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // history = full display history (persisted to server, survives refresh)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftApplied, setDraftApplied] = useState(false); // only for draft mode auto-apply
  const [changes, setChanges] = useState<ParsedChange[] | null>(null);
  const [editApplied, setEditApplied] = useState(false);
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

  // Persist a history entry to the server
  const persistEntry = useCallback(
    (entry: HistoryEntry) => {
      fetch("/api/ai/chat-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          entryType: entry.type === "mode-change" ? "mode-change" : "message",
          role: entry.type === "message" ? entry.role : null,
          content: entry.type === "message" ? entry.content : null,
          mode: entry.mode,
        }),
      }).catch(() => {}); // fire and forget
    },
    [documentId]
  );

  // Load history from server on mount
  useEffect(() => {
    fetch(`/api/ai/chat-history?documentId=${documentId}`)
      .then((r) => r.json())
      .then((entries: { entryType: string; role: string | null; content: string | null; mode: string; createdAt: string }[]) => {
        if (!Array.isArray(entries)) return;
        const loaded: HistoryEntry[] = entries.map((e) =>
          e.entryType === "mode-change"
            ? { type: "mode-change" as const, mode: e.mode as Mode, timestamp: new Date(e.createdAt).getTime() }
            : { type: "message" as const, role: e.role as "user" | "assistant", content: e.content || "", mode: e.mode as Mode }
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

  // On mode change: reset AI context, persist mode divider.
  // Keyed on `selection` because that's what drives mode, but we only act
  // when the *mode* actually flips — not on every cursor selection change.
  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;

    if (prevMode === null) {
      // Initial mount — set model, don't reset (no prior state to clear).
      onSetModel("gemini-3.1-pro-preview");
      onSetThinking(false);
      return;
    }

    if (prevMode === mode) return; // selection changed but mode didn't — do nothing

    const entry: HistoryEntry = {
      type: "mode-change",
      mode,
      timestamp: Date.now(),
    };
    setHistory((prev) => [...prev, entry]);
    persistEntry(entry);

    setMessages([]);
    setInput("");
    setError(null);
    setDraftApplied(false);
    setChanges(null);
    setEditApplied(false);
    setFeedbackApplied(false);
    setTimeout(() => inputRef.current?.focus(), 50);

    onSetModel("gemini-3.1-pro-preview");
    onSetThinking(false);
  }, [selection]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const sendMessages = useCallback(
    async (msgs: ChatMessage[]) => {
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

        // Chat mode with signal 0: apply full document to editor
        if (mode === "chat" && chatSignal === "0") {
          onApplyDraft(cleanAccumulated);
          setDraftApplied(true);

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

        // Chat mode with signal 2: parse targeted changes into change cards
        if (mode === "chat" && chatSignal === "2") {
          const parsed = parseChanges(cleanAccumulated);
          if (parsed && parsed.length > 0) {
            setChanges(parsed);
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
    [mode, modelId, thinking]
  );

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    const userContent = buildUserMessage(input);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    // Empty placeholder — rendered as "Thinking..." in the UI but NOT sent to AI
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput("");
    setEditApplied(false);
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
    sendMessages(newMessages.filter((m) => m.content));
  }, [input, isStreaming, messages, sendMessages, mode]);

  function buildUserMessage(userInput: string): string {
    const liveContent = editorRef.current?.getContentJSON() ?? null;
    const contextBlock = buildAIContext({
      tabs,
      activeTab,
      activeTabLiveContent: liveContent,
      mode: mode === "edit" ? "edit" : "chat",
      selection: selection
        ? {
            taggedText: selection.taggedText,
            surroundingContext: selection.surroundingContext,
          }
        : null,
    });

    if (mode === "edit" && selection) {
      if (messages.length === 0) {
        return `${contextBlock}\n\n${selection.surroundingContext || ""}\n## Selected Text (rewrite THIS only, using structural tags)\n${selection.taggedText}\n\n## Instruction\n${userInput}`;
      }
      const selectionPreview = selection.text.slice(0, 120).replace(/\n/g, " ").trim();
      return `[Follow-up — original selection still active: "${selectionPreview}${selection.text.length > 120 ? "..." : ""}"]\n\n## Instruction\n${userInput}`;
    }
    if (mode === "chat") {
      return `${contextBlock}\n\n## Message\n${userInput}`;
    }
    return userInput;
  }

  // ─── Last assistant message analysis ───
  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  const lastContent = lastAssistantMsg?.content || "";
  const isClarifying = lastContent.startsWith("[CLARIFY]");
  const hasTaggedContent =
    mode === "edit" &&
    !isClarifying &&
    lastContent.length > 0 &&
    /^\[(?:H\d|OL|UL|P)]/m.test(lastContent);
  // ─── Apply handlers ───
  const handleApplyEdit = () => {
    if (!lastContent) return;
    onApplyEdit(lastContent);
    setEditApplied(true);
  };

  const handleRejectEdit = () => {
    onRejectEdit();
    setEditApplied(true);
  };


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

  const handleFormatDocument = useCallback(async () => {
    if (isStreaming) return;
    setIsStreaming(true);
    setStreamingText("");
    setError(null);

    const liveContent = editorRef.current?.getContentJSON() ?? null;
    const activeTagged = tiptapJsonToTagged(liveContent) || tiptapJsonToTagged(activeTab.content);

    const userMessage = `## Active Tab — ${activeTab.title} (${activeTab.type})\n${activeTagged || "(empty)"}`;

    const userEntry: HistoryEntry = { type: "message", role: "user", content: "Format document", mode: "format" as Mode };
    setHistory((prev) => [...prev, userEntry]);
    persistEntry(userEntry);

    try {
      const res = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
          mode: "format",
          modelId,
          thinking: false,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Format failed");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setStreamingText(accumulated);
        }
      }

      if (accumulated) {
        onApplyDraft(accumulated);
        const assistantEntry: HistoryEntry = { type: "message", role: "assistant", content: "Document has been reformatted.", mode: "format" as Mode };
        setHistory((prev) => [...prev, assistantEntry]);
        persistEntry(assistantEntry);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Format failed");
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [isStreaming, modelId, editorRef, activeTab, onApplyDraft, persistEntry]);

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

  const modeLabel = mode === "edit" ? "Edit Selection" : "Chat";

  const placeholder =
    mode === "edit"
      ? "Describe how to edit the selected text..."
      : "What would you like to do? (e.g. 'add an episode', 'tighten dialogue in ep 3')";

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
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg"
        >
          &times;
        </button>
      </div>

      {/* Workbook actions — durable AI jobs (Plot Chunks / Next Episode Plot
          / Next Reference Episode). Lives outside the scroll area so the
          panel stays visible at the top regardless of chat history length. */}
      {activeTab.type === "workbook" && (
        <WorkbookActions
          documentId={documentId}
          tabId={activeTab.id}
          modelId={modelId}
          thinking={thinking}
          getCurrentTagged={() =>
            tiptapJsonToTagged(
              editorRef.current?.getContentJSON() ?? activeTab.content
            )
          }
          applyMergedContent={(taggedContent) => onApplyDraft(taggedContent)}
        />
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Empty state */}
        {history.length === 0 && messages.length === 0 && !isStreaming && (
          <div className="py-6 text-sm text-gray-500">
            {mode === "edit" && (
              <p className="text-center">Describe how to edit the selected text.</p>
            )}
            {mode === "chat" && (
              <div className="flex flex-col gap-3">
                <p className="text-center text-gray-400">
                  {activeTab.type === "workbook"
                    ? "Use a workbook action above, or type your own prompt below."
                    : editorIsEmpty
                    ? "What would you like to do?"
                    : "What would you like to work on?"}
                </p>
                {activeTab.type !== "workbook" && (
                  <div className="flex flex-col gap-2">
                    {(editorIsEmpty
                      ? CHAT_QUICK_ACTIONS_EMPTY
                      : CHAT_QUICK_ACTIONS_EXISTING
                    ).map((action) => (
                      <button
                        key={action.label}
                        onClick={() => setInput(action.prompt)}
                        className="text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-700 transition-colors"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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

        {/* Flow A: Before/After diff */}
        {mode === "edit" && hasTaggedContent && !isStreaming && !editApplied && (
          <div className="space-y-3 pt-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1">
                Before
              </p>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                {selection?.text}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 mb-1">
                After
              </p>
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                {stripTagsForDisplay(lastContent)}
              </div>
            </div>
          </div>
        )}

        {/* Chat: Review mode selector */}
        {mode === "chat" && changes && !isStreaming && !feedbackApplied && reviewMode === null && changes.length > 1 && (
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
        {mode === "chat" && changes && !isStreaming && !feedbackApplied && reviewMode === "stepwise" && (
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
        {mode === "chat" && changes && !isStreaming && !feedbackApplied && (reviewMode === "bulk" || changes.length === 1) && (
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

      {/* Sticky Apply / Reject buttons for edit mode */}
      {mode === "edit" && hasTaggedContent && !isStreaming && !editApplied && (
        <div className="border-t border-gray-200 px-3 py-2 flex gap-2">
          <button
            onClick={handleRejectEdit}
            className="flex-1 rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 transition-colors"
          >
            Reject
          </button>
          <button
            onClick={handleApplyEdit}
            className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            Apply to document
          </button>
        </div>
      )}

      {/* Sticky buttons: stepwise mode */}
      {mode === "chat" && changes && !feedbackApplied && !isStreaming && reviewMode === "stepwise" && (
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
      {mode === "chat" && changes && !feedbackApplied && !isStreaming && (reviewMode === "bulk" || changes.length === 1) && (
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

      {/* Format document — structured tabs only */}
      {!editorIsEmpty && (
        <div className="border-t border-gray-100 px-3 pt-2">
          <button
            onClick={handleFormatDocument}
            disabled={isStreaming}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40 transition-colors"
          >
            Format document
          </button>
        </div>
      )}

      {/* Input — always visible, disabled during streaming */}
      <div className="border-t border-gray-200 p-3 space-y-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            rows={3}
            disabled={isStreaming}
            className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none transition-colors ${
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
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {isStreaming ? "Generating..." : "Send"}
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
  } else if (mode === "edit" && isLast && /^\[(?:H\d|OL|UL|P)]/m.test(content)) {
    // Don't show raw tagged content in chat for current edit — it's in the diff view
    displayContent = "";
  } else if (mode === "edit" && !isLast && /^\[(?:H\d|OL|UL|P)]/m.test(content)) {
    // History entry — show clean AFTER content (tags stripped)
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
