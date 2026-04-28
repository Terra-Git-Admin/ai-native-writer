"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import Editor, { EditorHandle, TaggedBlock, HeadingItem } from "@/components/editor/Editor";
import TabRail, { TabRow } from "@/components/editor/TabRail";
import AIChatSidebar from "@/components/ai/AIChatSidebar";
import CommentSidebar from "@/components/comments/CommentSidebar";
import VersionHistory from "@/components/editor/VersionHistory";
import PromptEditor from "@/components/settings/PromptEditor";

interface DocumentData {
  id: string;
  title: string;
  content: string | null;
  activeTabId: string | null;
  ownerId: string;
  isOwner: boolean;
}

export default function DocumentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const editorRef = useRef<EditorHandle>(null);
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [tabs, setTabs] = useState<TabRow[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [titleSaveTimeout, setTitleSaveTimeout] =
    useState<NodeJS.Timeout | null>(null);

  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
  const [aiSelection, setAiSelection] = useState<{
    text: string;
    taggedText: string;
    taggedBlocks: TaggedBlock[];
    from: number;
    to: number;
    surroundingContext: string;
  } | null>(null);

  const [commentSidebarOpen, setCommentSidebarOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [openCommentCount, setOpenCommentCount] = useState(0);
  const [pendingComment, setPendingComment] = useState<{
    markId: string;
    quotedText: string;
    from: number;
    to: number;
  } | null>(null);

  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);

  // Live headings of the active tab — fed by the editor on every transaction
  // and consumed by the rail for the active tab's nested outline, so a newly
  // typed [H3] appears in the rail immediately rather than waiting for a
  // tabs-refetch.
  const [activeTabHeadings, setActiveTabHeadings] = useState<HeadingItem[]>([]);

  const [aiModels, setAiModels] = useState<
    { id: string; label: string; provider: string; thinking?: boolean }[]
  >([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  const AI_SIDEBAR_DEFAULT = 460;
  const AI_SIDEBAR_MIN = 320;
  const AI_SIDEBAR_MAX = 900;
  const [aiSidebarWidth, setAiSidebarWidth] = useState(AI_SIDEBAR_DEFAULT);
  const aiSidebarWidthRef = useRef(AI_SIDEBAR_DEFAULT);
  useEffect(() => {
    aiSidebarWidthRef.current = aiSidebarWidth;
  }, [aiSidebarWidth]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = Number(window.localStorage.getItem("aiSidebarWidth"));
    if (saved >= AI_SIDEBAR_MIN && saved <= AI_SIDEBAR_MAX) {
      setAiSidebarWidth(saved);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("aiSidebarWidth", String(aiSidebarWidth));
  }, [aiSidebarWidth]);
  const startAiSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = aiSidebarWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const next = Math.max(
        AI_SIDEBAR_MIN,
        Math.min(AI_SIDEBAR_MAX, startW + delta)
      );
      setAiSidebarWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const fetchTabs = useCallback(async (): Promise<TabRow[]> => {
    const res = await fetch(`/api/documents/${params.id}/tabs`);
    if (!res.ok) return [];
    const data: TabRow[] = await res.json();
    setTabs(data);
    return data;
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [docRes, tabsRes] = await Promise.all([
          fetch(`/api/documents/${params.id}`),
          fetch(`/api/documents/${params.id}/tabs`),
        ]);
        if (!docRes.ok) throw new Error("Not found");
        const docData: DocumentData = await docRes.json();
        const tabList: TabRow[] = tabsRes.ok ? await tabsRes.json() : [];
        if (cancelled) return;

        setDoc(docData);
        setTitle(docData.title);
        setTabs(tabList);

        const urlTab = searchParams.get("tab");
        let target: string | null = null;
        if (urlTab && tabList.find((t) => t.id === urlTab)) {
          target = urlTab;
        } else if (
          docData.activeTabId &&
          tabList.find((t) => t.id === docData.activeTabId)
        ) {
          target = docData.activeTabId;
        } else if (tabList[0]) {
          target = tabList[0].id;
        }

        setActiveTabId(target);
        setLoading(false);

        if (target && !urlTab) {
          const url = new URL(window.location.href);
          url.searchParams.set("tab", target);
          window.history.replaceState({}, "", url.toString());
        }

        if (target) {
          fetch(`/api/comments?documentId=${params.id}&tabId=${target}`)
            .then((r) => r.json())
            .then((comments) => {
              if (Array.isArray(comments) && comments.length > 0) {
                setCommentSidebarOpen(true);
              }
            })
            .catch(() => {});
        }
      } catch {
        if (!cancelled) router.push("/");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((models) => {
        if (Array.isArray(models) && models.length > 0) {
          const nonThinking = models.filter((m: { thinking?: boolean }) => !m.thinking);
          setAiModels(models);
          if (nonThinking.length > 0 && !selectedModelId) {
            setSelectedModelId(nonThinking[0].id);
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabSwitch = useCallback(
    async (tabId: string, scrollToHeadingText?: string) => {
      // Same-tab click with a heading target: scroll immediately.
      if (tabId === activeTabId) {
        if (scrollToHeadingText) {
          editorRef.current?.scrollToHeadingByText(scrollToHeadingText);
        }
        return;
      }

      // 1. Flush any pending debounced save for the CURRENT tab before the
      // editor unmounts. Without this, a 1-second debounced save in progress
      // when the writer clicked a new tab was thrown away.
      try {
        await editorRef.current?.flushPendingSave?.();
      } catch {
        /* logged via client-trace */
      }

      // 2. Fetch fresh content for the TARGET tab. The `tabs` state cache is
      // populated at page load and never refreshed by editing, so switching
      // back to a tab previously showed a stale snapshot — the exact mechanism
      // behind "my work disappeared when I switched tabs" and the source of
      // the yellow-banner loop.
      try {
        const res = await fetch(
          `/api/documents/${params.id}/tabs/${tabId}/content`
        );
        if (res.ok) {
          const fresh = await res.json();
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? {
                    ...t,
                    content: fresh.content ?? null,
                    updatedAt: fresh.updatedAt ?? t.updatedAt,
                  }
                : t
            )
          );
        }
      } catch {
        /* fall back to cached content — editor will remount with whatever we have */
      }

      // 3. Swap the active tab. Editor remount now reads the freshly-fetched
      // activeTabContent derived from updated tabs state.
      setActiveTabId(tabId);
      // Clear edit selection (it was for the previous tab's editor) but
      // KEEP the AI sidebar open across tab switches — the writer expects
      // the assistant to follow them as they navigate. The sidebar component
      // re-scopes its state to the new (documentId, activeTabId) on its own.
      setAiSelection(null);
      setActiveCommentId(null);
      setPendingComment(null);
      setActiveTabHeadings([]);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tabId);
      window.history.pushState({}, "", url.toString());
      if (scrollToHeadingText) {
        setTimeout(() => {
          editorRef.current?.scrollToHeadingByText(scrollToHeadingText);
        }, 400);
      }
    },
    [activeTabId, params.id]
  );

  const handleTabsChange = useCallback(async () => {
    const list = await fetchTabs();
    if (activeTabId && !list.find((t) => t.id === activeTabId)) {
      if (list[0]) handleTabSwitch(list[0].id);
    }
  }, [activeTabId, fetchTabs, handleTabSwitch]);

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      if (titleSaveTimeout) clearTimeout(titleSaveTimeout);
      const timeout = setTimeout(async () => {
        await fetch(`/api/documents/${params.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
      }, 1000);
      setTitleSaveTimeout(timeout);
    },
    [params.id, titleSaveTimeout]
  );

  const handleAIEditRequest = useCallback(
    (
      displayText: string,
      taggedText: string,
      taggedBlocks: TaggedBlock[],
      from: number,
      to: number,
      surroundingContext: string
    ) => {
      setAiSelection({ text: displayText, taggedText, taggedBlocks, from, to, surroundingContext });
      setAiSidebarOpen(true);
      setCommentSidebarOpen(false);
      editorRef.current?.highlightSelection(from, to, "#bbf7d0");
    },
    []
  );

  const handleAddComment = useCallback(
    (commentMarkId: string, quotedText: string, from: number, to: number) => {
      console.log("[save-trace]", {
        event: "client.comment.addStart",
        documentId: params.id,
        tabId: activeTabId,
        commentMarkId,
        quotedTextLen: quotedText.length,
        selectionFrom: from,
        selectionTo: to,
      });
      setPendingComment({ markId: commentMarkId, quotedText, from, to });
      setCommentSidebarOpen(true);
      setAiSidebarOpen(false);
    },
    [params.id, activeTabId]
  );

  const handleActiveCommentChange = useCallback(
    (commentMarkId: string | null) => {
      setActiveCommentId(commentMarkId);
      if (commentMarkId && editorRef.current) {
        editorRef.current.scrollToComment(commentMarkId);
      }
    },
    []
  );

  const handleCommentMarkClick = useCallback(
    (commentMarkId: string) => {
      setCommentSidebarOpen(true);
      setAiSidebarOpen(false);
      setVersionHistoryOpen(false);
      setPromptsOpen(false);
      setActiveCommentId(commentMarkId);
    },
    []
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!doc || !activeTabId) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeTabContent = activeTab?.content ?? null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            &larr; Back
          </button>
          {doc.isOwner ? (
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="border-0 bg-transparent text-lg font-semibold focus:outline-none focus:ring-0"
              placeholder="Untitled"
            />
          ) : (
            <h1 className="text-lg font-semibold">{title}</h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          {doc.isOwner && aiModels.length > 0 && (
            <>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-300 focus:outline-none"
              >
                {aiModels
                  .filter((m) => !m.thinking)
                  .map((m) => (
                    <option key={`${m.provider}-${m.id}`} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={thinkingEnabled}
                  onChange={(e) => setThinkingEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Thinking
              </label>
              <div className="mx-1 h-5 w-px bg-gray-200" />
            </>
          )}

          <button
            onClick={() => {
              setCommentSidebarOpen(!commentSidebarOpen);
              if (!commentSidebarOpen) {
                setAiSidebarOpen(false);
                setVersionHistoryOpen(false);
                setPromptsOpen(false);
              }
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              commentSidebarOpen
                ? "bg-yellow-100 text-yellow-700"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Comments
            {openCommentCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-yellow-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                {openCommentCount}
              </span>
            )}
          </button>
          {doc.isOwner && (
            <>
              <button
                onClick={() => {
                  setVersionHistoryOpen(!versionHistoryOpen);
                  if (!versionHistoryOpen) {
                    setAiSidebarOpen(false);
                    setCommentSidebarOpen(false);
                    setPromptsOpen(false);
                  }
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  versionHistoryOpen
                    ? "bg-gray-200 text-gray-900"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                History
              </button>
              <button
                onClick={() => {
                  setAiSidebarOpen(!aiSidebarOpen);
                  if (!aiSidebarOpen) {
                    setCommentSidebarOpen(false);
                    setVersionHistoryOpen(false);
                    setPromptsOpen(false);
                  }
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  aiSidebarOpen
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                AI Assistant
              </button>
              <button
                onClick={() => {
                  setPromptsOpen(!promptsOpen);
                  if (!promptsOpen) {
                    setAiSidebarOpen(false);
                    setCommentSidebarOpen(false);
                    setVersionHistoryOpen(false);
                  }
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  promptsOpen
                    ? "bg-gray-200 text-gray-900"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Prompts
              </button>
            </>
          )}
          {session?.user?.name && (
            <div className="ml-2 flex items-center gap-2">
              {session.user.image && (
                <img
                  src={session.user.image}
                  alt=""
                  className="h-7 w-7 rounded-full"
                />
              )}
              <span className="text-sm text-gray-500">
                {session.user.name}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <TabRail
          documentId={doc.id}
          tabs={tabs}
          activeTabId={activeTabId}
          activeTabHeadings={activeTabHeadings}
          isOwner={doc.isOwner}
          onSwitch={handleTabSwitch}
          onTabsChange={handleTabsChange}
        />

        <Editor
          key={activeTabId}
          ref={editorRef}
          documentId={doc.id}
          tabId={activeTabId}
          initialContent={activeTabContent}
          isOwner={doc.isOwner}
          activeCommentId={activeCommentId}
          onAIEditRequest={doc.isOwner ? handleAIEditRequest : undefined}
          onAddComment={handleAddComment}
          onCommentMarkClick={handleCommentMarkClick}
          onHeadingsChange={setActiveTabHeadings}
        />

        {commentSidebarOpen && (
          <div className="w-80 border-l border-gray-200 bg-gray-50">
            <CommentSidebar
              documentId={doc.id}
              tabId={activeTabId}
              activeCommentId={activeCommentId}
              onActiveCommentChange={handleActiveCommentChange}
              pendingComment={pendingComment}
              onPendingCommentDone={() => setPendingComment(null)}
              onApplyCommentMark={(commentMarkId) => {
                if (pendingComment) {
                  editorRef.current?.applyCommentMark(
                    commentMarkId,
                    pendingComment.from,
                    pendingComment.to
                  );
                }
              }}
              onRemoveCommentMark={(commentMarkId) => {
                editorRef.current?.removeCommentMark(commentMarkId);
              }}
              onCountChange={setOpenCommentCount}
            />
          </div>
        )}
        {aiSidebarOpen && activeTab && (
          <div
            className="relative shrink-0 border-l border-gray-200 bg-gray-50"
            style={{ width: aiSidebarWidth }}
          >
            <div
              onMouseDown={startAiSidebarDrag}
              title="Drag to resize"
              className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-indigo-200/60 active:bg-indigo-300/70"
            />
            <AIChatSidebar
              documentId={doc.id}
              tabs={tabs}
              activeTab={activeTab}
              editorRef={editorRef}
              selection={aiSelection}
              editorIsEmpty={editorRef.current?.isEmpty() ?? !activeTabContent}
              modelId={selectedModelId}
              thinking={thinkingEnabled}
              onApplyEdit={(taggedAIResponse) => {
                if (aiSelection) {
                  editorRef.current?.removeHighlight(aiSelection.from, aiSelection.to);
                  editorRef.current?.replaceRange(
                    taggedAIResponse,
                    aiSelection.taggedBlocks,
                    aiSelection.from,
                    aiSelection.to
                  );
                }
              }}
              onRejectEdit={() => {
                if (aiSelection) {
                  editorRef.current?.removeHighlight(aiSelection.from, aiSelection.to);
                }
              }}
              onApplyDraft={(content) => {
                editorRef.current?.setFullContent(content);
              }}
              onApplyChange={(original, suggested) => {
                editorRef.current?.findAndReplace(original, suggested);
              }}
              onSetModel={(id) => setSelectedModelId(id)}
              onSetThinking={(enabled) => setThinkingEnabled(enabled)}
              onSetTitle={(newTitle) => {
                setTitle(newTitle);
                fetch(`/api/documents/${params.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title: newTitle }),
                });
              }}
              onClose={() => {
                if (aiSelection) {
                  editorRef.current?.removeHighlight(aiSelection.from, aiSelection.to);
                }
                setAiSidebarOpen(false);
                setAiSelection(null);
              }}
            />
          </div>
        )}
        {versionHistoryOpen && (
          <div className="w-80 border-l border-gray-200 bg-gray-50">
            <VersionHistory
              documentId={doc.id}
              tabId={activeTabId}
              tabTitle={activeTab?.title ?? null}
              onRevert={() => {
                setVersionHistoryOpen(false);
                window.location.reload();
              }}
              onClose={() => setVersionHistoryOpen(false)}
            />
          </div>
        )}
        {promptsOpen && (
          <div className="w-96 border-l border-gray-200 bg-gray-50">
            <PromptEditor onClose={() => setPromptsOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
