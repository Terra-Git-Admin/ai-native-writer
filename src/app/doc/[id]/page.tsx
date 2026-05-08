"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import Editor, { EditorHandle, HeadingItem } from "@/components/editor/Editor";
import TabRail, { TabRow } from "@/components/editor/TabRail";
import AIChatSidebar from "@/components/ai/AIChatSidebar";
import QualityAgentModal from "@/components/ai/QualityAgentModal";
import CommentSidebar from "@/components/comments/CommentSidebar";
import VersionHistory from "@/components/editor/VersionHistory";
import PromptEditor from "@/components/settings/PromptEditor";
import { useJob } from "@/lib/ai/useJob";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { taggedTextToTiptapDoc } from "@/lib/editor/tagged-parser";

export type ApplyToTabResult = {
  ok: boolean;
  reason?: string;
  landedTabId?: string;
  fellBack?: boolean;
};

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
  const [qualityModalOpen, setQualityModalOpen] = useState(false);
  const [qualityEvalRequest, setQualityEvalRequest] = useState<{
    episodeTabId: string;
    episodeLabel: string;
    episodeIndex: number;
  } | null>(null);

  // Live headings of the active tab — fed by the editor on every transaction
  // and consumed by the rail for the active tab's nested outline, so a newly
  // typed [H3] appears in the rail immediately rather than waiting for a
  // tabs-refetch.
  const [activeTabHeadings, setActiveTabHeadings] = useState<HeadingItem[]>([]);
  const [commentMarkPositions, setCommentMarkPositions] = useState<Record<string, number>>({});

  const [aiModels, setAiModels] = useState<
    { id: string; label: string; provider: string; thinking?: boolean }[]
  >([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  // Durable AI job (workbook actions: Plot Chunks / Next Episode Plot /
  // Next Reference Episode). Hoisted to the doc-page level so the
  // EventSource and accumulated output survive AI-sidebar open/close —
  // closing the sidebar should NOT abort an in-flight generation. The
  // hook's cleanup only fires when the user navigates away from the doc.
  const aiJob = useJob({
    documentId: params.id,
    tabId: activeTabId ?? "",
    modelId: selectedModelId,
    thinking: thinkingEnabled,
  });

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
      // KEEP the AI sidebar open across tab switches — the writer expects
      // the assistant to follow them as they navigate. The sidebar component
      // re-scopes its state to the new (documentId, activeTabId) on its own.
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

  // Route AI output to its origin tab. Same-tab uses the live editor
  // (picks up unsaved edits); cross-tab uses the tab-content PUT endpoint
  // (durable, version-snapshotted). Falls back to workbook if origin tab
  // was deleted; returns reason="target_tab_missing" if no workbook either.
  // Caller is the AIChatSidebar — see onApplyToTab in the JSX below.
  const applyToTab = useCallback(
    async (
      originTabId: string,
      taggedContent: string,
      mode: "replace" | "append",
      opts?: { label?: string }
    ): Promise<ApplyToTabResult> => {
      let target = tabs.find((t) => t.id === originTabId);
      let fellBack = false;
      if (!target) {
        target = tabs.find((t) => t.type === "workbook");
        fellBack = true;
      }
      if (!target) {
        return { ok: false, reason: "target_tab_missing", fellBack };
      }
      const targetTabId = target.id;

      // Workbook append → create a new "Page N" tab so each AI output gets
      // its own named page rather than accumulating inside the workbook body.
      if (mode === "append" && target.type === "workbook") {
        const nextN = tabs.filter((t) => t.type === "custom").length + 1;
        const timestamp = new Date().toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const note = `[P] ${opts?.label ?? "AI Output"} · ${timestamp}`;
        const fullContent = `${note}\n\n${taggedContent.trim()}`;

        const createRes = await fetch(`/api/documents/${params.id}/tabs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `Page ${nextN}` }),
        });
        if (!createRes.ok) {
          return {
            ok: false,
            reason: `create_tab_failed_${createRes.status}`,
            landedTabId: targetTabId,
            fellBack,
          };
        }
        const newTabRow = await createRes.json();
        const newTabId: string = newTabRow.id;

        const tiptapDoc = taggedTextToTiptapDoc(fullContent);
        const jsonString = JSON.stringify(tiptapDoc);
        const putRes = await fetch(
          `/api/documents/${params.id}/tabs/${newTabId}/content`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: jsonString,
              forceVersion: true,
              versionReason: "ai_apply",
            }),
          }
        );
        if (!putRes.ok) {
          return {
            ok: false,
            reason: `put_page_failed_${putRes.status}`,
            landedTabId: newTabId,
            fellBack,
          };
        }

        setTabs((prev) => [
          ...prev,
          { ...newTabRow, content: jsonString, isProtected: false, updatedAt: new Date() },
        ]);
        setActiveTabId(newTabId);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", newTabId);
        window.history.pushState({}, "", url.toString());
        return { ok: true, landedTabId: newTabId, fellBack };
      }

      // Same tab as the active editor: write through editorRef so the
      // user sees the change immediately and any unsaved live edits in
      // the active editor are merged correctly for append mode.
      if (targetTabId === activeTabId) {
        let content = taggedContent;
        if (mode === "append") {
          const liveJson =
            editorRef.current?.getContentJSON() ?? target.content ?? null;
          const liveTagged = tiptapJsonToTagged(liveJson);
          content = liveTagged.trim()
            ? `${liveTagged.trim()}\n\n${taggedContent.trim()}`
            : taggedContent.trim();
        }
        editorRef.current?.setFullContent(content);
        return { ok: true, landedTabId: targetTabId, fellBack };
      }

      // Cross-tab: build merged tagged text, parse to Tiptap JSON, PUT.
      let outgoing = taggedContent;
      if (mode === "append") {
        const existingTagged = tiptapJsonToTagged(target.content ?? null);
        outgoing = existingTagged.trim()
          ? `${existingTagged.trim()}\n\n${taggedContent.trim()}`
          : taggedContent.trim();
      }
      const doc = taggedTextToTiptapDoc(outgoing);
      const jsonString = JSON.stringify(doc);
      const res = await fetch(
        `/api/documents/${params.id}/tabs/${targetTabId}/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: jsonString,
            forceVersion: true,
            versionReason: "ai_apply",
          }),
        }
      );
      if (!res.ok) {
        return {
          ok: false,
          reason: `put_failed_${res.status}`,
          landedTabId: targetTabId,
          fellBack,
        };
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === targetTabId
            ? { ...t, content: jsonString, updatedAt: new Date() }
            : t
        )
      );
      return { ok: true, landedTabId: targetTabId, fellBack };
    },
    [tabs, activeTabId, params.id]
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
            </>
          )}
          {(session?.user as { role?: string })?.role === "admin" &&
            activeTab?.type === "predefined_episodes" && (
              <button
                onClick={() => setQualityModalOpen(true)}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
              >
                Quality Agent
              </button>
            )}
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
          tabType={activeTab?.type}
          initialContent={activeTabContent}
          isOwner={doc.isOwner}
          activeCommentId={activeCommentId}
          onAddComment={handleAddComment}
          onCommentMarkClick={handleCommentMarkClick}
          onHeadingsChange={setActiveTabHeadings}
          onCommentMarkPositions={setCommentMarkPositions}
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
              h3Headings={activeTabHeadings.filter((h) => h.level === 3)}
              commentMarkPositions={commentMarkPositions}
              showSectionFilter={
                activeTab?.type === "predefined_episodes" &&
                (doc.isOwner || (session?.user as { role?: string })?.role === "admin")
              }
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
              editorIsEmpty={editorRef.current?.isEmpty() ?? !activeTabContent}
              modelId={selectedModelId}
              thinking={thinkingEnabled}
              aiJob={aiJob}
              onApplyToTab={applyToTab}
              onFlushPendingSave={async () => {
                try {
                  await editorRef.current?.flushPendingSave?.();
                } catch {
                  /* logged via client-trace */
                }
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
                setAiSidebarOpen(false);
              }}
              qualityEvalRequest={qualityEvalRequest}
              onQualityEvalConsumed={() => setQualityEvalRequest(null)}
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

      {qualityModalOpen && activeTabId && (
        <QualityAgentModal
          tabs={tabs}
          currentTabId={activeTabId}
          onConfirm={(episodeTabId, episodeLabel, episodeIndex) => {
            setQualityModalOpen(false);
            setAiSidebarOpen(true);
            setCommentSidebarOpen(false);
            setVersionHistoryOpen(false);
            setPromptsOpen(false);
            setQualityEvalRequest({ episodeTabId, episodeLabel, episodeIndex });
          }}
          onCancel={() => setQualityModalOpen(false)}
        />
      )}
    </div>
  );
}
