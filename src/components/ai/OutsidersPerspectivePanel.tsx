"use client";

import { useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface OutsidersPerspectivePanelProps {
  documentId: string;
  episodeTabId: string;
  episodeIndex: number;
  episodeLabel: string;
  onClose: () => void;
}

function isLikelyCutOff(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed.length > 300 &&
    !/[.!?]\s*$/.test(trimmed) &&
    !/```\s*$/.test(trimmed)
  );
}

export default function OutsidersPerspectivePanel({
  documentId,
  episodeTabId,
  episodeIndex,
  episodeLabel,
  onClose,
}: OutsidersPerspectivePanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const send = async (overrideInput?: string) => {
    const text = (overrideInput ?? input).trim();
    if (!text || isStreaming) return;

    setInput("");
    setError(null);

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setIsStreaming(true);
    setStreamingContent("");

    setTimeout(scrollToBottom, 50);

    try {
      const res = await fetch(`/api/documents/${documentId}/outsiders-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, episodeTabId, episodeIndex }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Analysis failed");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setStreamingContent(accumulated.replace(/^[012]\n/, ""));
          scrollToBottom();
        }
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: accumulated.replace(/^[012]\n/, "") },
      ]);
      setStreamingContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const quickActions = [
    "Full analysis — all four dimensions",
    "Character logic & role consistency only",
    "Emotion graph for all characters",
    "Plot logic check",
  ];

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            Outsiders Perspective
          </p>
          <p className="truncate text-sm font-medium text-gray-800">{episodeLabel}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-2 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !isStreaming && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Loaded: previous 3 episodes + plot outline for this episode. Choose a focus.
            </p>
            {quickActions.map((action) => (
              <button
                key={action}
                onClick={() => send(action)}
                className="block w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 transition-colors hover:bg-amber-100"
              >
                {action}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => {
          const isLastAssistant =
            msg.role === "assistant" && i === messages.length - 1 && !isStreaming;
          const cutOff = isLastAssistant && isLikelyCutOff(msg.content);
          return (
            <div key={i} className="flex flex-col">
              <div
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-amber-600 text-white"
                      : "whitespace-pre-wrap border border-gray-200 bg-white text-gray-800"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
              {cutOff && (
                <p className="mt-1 pl-1 text-xs text-gray-400">
                  Response may be cut off — type &quot;continue&quot; to get the rest
                </p>
              )}
            </div>
          );
        })}

        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
              {streamingContent ? (
                <>
                  <span className="whitespace-pre-wrap">{streamingContent}</span>
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-amber-500 align-middle" />
                </>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: "300ms" }} />
                </span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about a character, scene, or plot decision…"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-50"
            disabled={isStreaming}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
