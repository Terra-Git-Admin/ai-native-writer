"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import Editor, { EditorHandle, TaggedBlock, HeadingItem } from "@/components/editor/Editor";
import DocumentOutline from "@/components/editor/DocumentOutline";
import AIChatSidebar from "@/components/ai/AIChatSidebar";
import CommentSidebar from "@/components/comments/CommentSidebar";
import VersionHistory from "@/components/editor/VersionHistory";
import PromptEditor from "@/components/settings/PromptEditor";

interface DocumentData {
  id: string;
  title: string;
  content: string | null;
  ownerId: string;
  isOwner: boolean;
}

export default function DocumentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const editorRef = useRef<EditorHandle>(null);
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [titleSaveTimeout, setTitleSaveTimeout] =
    useState<NodeJS.Timeout | null>(null);

  // AI sidebar state
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
  const [aiSelection, setAiSelection] = useState<{
    text: string;
    taggedText: string;
    taggedBlocks: TaggedBlock[];
    from: number;
    to: number;
    surroundingContext: string;
  } | null>(null);

  // Comment sidebar state
  const [commentSidebarOpen, setCommentSidebarOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [pendingComment, setPendingComment] = useState<{
    markId: string;
    quotedText: string;
    from: number;
    to: number;
  } | null>(null);

  // Version history state
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  // Prompts panel state
  const [promptsOpen, setPromptsOpen] = useState(false);

  // Document outline headings
  const [headings, setHeadings] = useState<HeadingItem[]>([]);

  // AI model selection
  const [aiModels, setAiModels] = useState<
    { id: string; label: string; provider: string; thinking?: boolean }[]
  >([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  useEffect(() => {
    fetch(`/api/documents/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setDoc(data);
        setTitle(data.title);
        setLoading(false);

        // Auto-open comments sidebar if doc has comments
        fetch(`/api/comments?documentId=${params.id}`)
          .then((r) => r.json())
          .then((comments) => {
            if (comments.length > 0) {
              setCommentSidebarOpen(true);
            }
          })
          .catch(() => {});
      })
      .catch(() => {
        router.push("/");
      });
  }, [params.id, router]);

  // Fetch available AI models
  useEffect(() => {
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((models) => {
        if (Array.isArray(models) && models.length > 0) {
          // Filter to non-thinking models for the dropdown
          const nonThinking = models.filter((m: { thinking?: boolean }) => !m.thinking);
          setAiModels(models);
          if (nonThinking.length > 0 && !selectedModelId) {
            setSelectedModelId(nonThinking[0].id);
          }
        }
      })
      .catch(() => {});
  }, []);

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
      // Highlight selected text in editor
      editorRef.current?.highlightSelection(from, to, "#bbf7d0");
    },
    []
  );

  const handleAddComment = useCallback(
    (commentMarkId: string, quotedText: string, from: number, to: number) => {
      setPendingComment({ markId: commentMarkId, quotedText, from, to });
      setCommentSidebarOpen(true);
      setAiSidebarOpen(false);
    },
    []
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!doc) return null;

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
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
          {/* Model selector + thinking toggle (owner only) */}
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
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              commentSidebarOpen
                ? "bg-yellow-100 text-yellow-700"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Comments
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

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Document outline panel */}
        <DocumentOutline
          headings={headings}
          onScrollTo={(pos) => editorRef.current?.scrollToHeading(pos)}
        />

        {/* Editor */}
        <Editor
          ref={editorRef}
          documentId={doc.id}
          initialContent={doc.content}
          isOwner={doc.isOwner}
          activeCommentId={activeCommentId}
          onAIEditRequest={doc.isOwner ? handleAIEditRequest : undefined}
          onAddComment={handleAddComment}
          onHeadingsChange={setHeadings}
        />

        {/* Right Sidebar */}
        {commentSidebarOpen && (
          <div className="w-80 border-l border-gray-200 bg-gray-50">
            <CommentSidebar
              documentId={doc.id}
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
            />
          </div>
        )}
        {aiSidebarOpen && (
          <div className="w-96 border-l border-gray-200 bg-gray-50">
            <AIChatSidebar
              documentId={doc.id}
              selection={aiSelection}
              editorIsEmpty={editorRef.current?.isEmpty() ?? !doc.content}
              fullDocumentText={editorRef.current?.getFullText() ?? ""}
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
              onRevert={(content) => {
                // Reload the page to pick up the reverted content
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
