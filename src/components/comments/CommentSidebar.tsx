"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";

interface Comment {
  id: string;
  commentMarkId: string;
  content: string;
  quotedText: string | null;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  parentId: string | null;
  resolved: boolean;
  createdAt: string;
}

interface CommentSidebarProps {
  documentId: string;
  activeCommentId: string | null;
  onActiveCommentChange: (commentMarkId: string | null) => void;
  pendingComment: { markId: string; quotedText: string; from: number; to: number } | null;
  onPendingCommentDone: () => void;
  onApplyCommentMark: (commentMarkId: string) => void;
  onRemoveCommentMark: (commentMarkId: string) => void;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function CommentSidebar({
  documentId,
  activeCommentId,
  onActiveCommentChange,
  pendingComment,
  onPendingCommentDone,
  onApplyCommentMark,
  onRemoveCommentMark,
}: CommentSidebarProps) {
  const { data: session } = useSession();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const pendingRef = useRef<HTMLInputElement>(null);
  const pendingContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const fetchComments = useCallback(async () => {
    const res = await fetch(`/api/comments?documentId=${documentId}`);
    if (res.ok) {
      const data = await res.json();
      setComments(data);
    }
  }, [documentId]);

  useEffect(() => {
    fetchComments();
    const interval = setInterval(fetchComments, 5000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  // Scroll to pending comment and focus input when it appears
  useEffect(() => {
    if (pendingComment && pendingContainerRef.current) {
      pendingContainerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
      // Focus the input after scroll
      setTimeout(() => pendingRef.current?.focus(), 100);
    }
  }, [pendingComment]);

  const addComment = async (
    content: string,
    markId: string,
    quotedText: string | null,
    parentId?: string
  ) => {
    if (!content.trim()) return;

    await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        commentMarkId: markId,
        content,
        quotedText,
        parentId: parentId || null,
      }),
    });

    fetchComments();
  };

  const handlePendingSubmit = async () => {
    if (!pendingComment || !newCommentText.trim()) return;
    await addComment(
      newCommentText,
      pendingComment.markId,
      pendingComment.quotedText
    );
    // Apply the highlight mark in the editor now that comment is saved
    onApplyCommentMark(pendingComment.markId);
    setNewCommentText("");
    onPendingCommentDone();
  };

  const handleReplySubmit = async (markId: string, parentId: string) => {
    if (!replyText.trim()) return;
    await addComment(replyText, markId, null, parentId);
    setReplyText("");
    setReplyingTo(null);
  };

  const resolveComment = async (commentId: string) => {
    await fetch(`/api/comments/${commentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    fetchComments();
  };

  const deleteComment = async (commentId: string, commentMarkId: string) => {
    await fetch(`/api/comments/${commentId}`, { method: "DELETE" });
    const remainingRoots = comments.filter(
      (c) =>
        c.commentMarkId === commentMarkId &&
        !c.parentId &&
        c.id !== commentId
    );
    if (remainingRoots.length === 0) {
      onRemoveCommentMark(commentMarkId);
    }
    fetchComments();
  };

  // Group comments by commentMarkId
  const grouped = comments.reduce(
    (acc, c) => {
      const key = c.commentMarkId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(c);
      return acc;
    },
    {} as Record<string, Comment[]>
  );

  const threads = Object.entries(grouped).map(([markId, items]) => {
    const root = items.filter((c) => !c.parentId);
    const replies = items.filter((c) => c.parentId);
    const resolved = root.some((c) => c.resolved);
    const quotedText = root.find((c) => c.quotedText)?.quotedText || null;
    return { markId, root, replies, resolved, quotedText };
  });

  const isActive = (markId: string) => activeCommentId === markId;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 px-4 py-3">
        <h3 className="font-semibold">Comments</h3>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {threads.length === 0 && !pendingComment && (
          <p className="text-sm text-gray-500 text-center py-8">
            No comments yet. Select text in the document to add a comment.
          </p>
        )}

        {threads.map(({ markId, root, replies, resolved, quotedText }) => (
          <div
            key={markId}
            onClick={() => onActiveCommentChange(isActive(markId) ? null : markId)}
            className={`cursor-pointer rounded-lg border p-3 space-y-2 transition-colors ${
              resolved
                ? "border-gray-200 bg-gray-50 opacity-60"
                : isActive(markId)
                  ? "border-yellow-400 bg-yellow-100 ring-1 ring-yellow-400"
                  : "border-yellow-200 bg-yellow-50 hover:border-yellow-300"
            }`}
          >
            {/* Quoted text */}
            {quotedText && (
              <p className="text-xs italic text-gray-500 border-l-2 border-yellow-400 pl-2 line-clamp-2">
                &ldquo;{quotedText}&rdquo;
              </p>
            )}

            {root.map((comment) => (
              <div key={comment.id}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {comment.authorImage && (
                      <img
                        src={comment.authorImage}
                        alt=""
                        className="h-5 w-5 rounded-full"
                      />
                    )}
                    <span className="text-xs font-medium text-gray-700">
                      {comment.authorName || "Anonymous"}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {formatTimestamp(comment.createdAt)}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!resolved && (
                      <button
                        onClick={() => resolveComment(comment.id)}
                        className="text-xs text-green-600 hover:text-green-800"
                        title="Resolve"
                      >
                        Resolve
                      </button>
                    )}
                    {comment.authorId === session?.user?.id && (
                      <button
                        onClick={() => deleteComment(comment.id, markId)}
                        className="text-xs text-red-500 hover:text-red-700"
                        title="Delete"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-gray-800">{comment.content}</p>
              </div>
            ))}

            {/* Replies */}
            {replies.map((reply) => (
              <div
                key={reply.id}
                className="ml-4 border-l-2 border-gray-200 pl-3"
              >
                <div className="flex items-center gap-2">
                  {reply.authorImage && (
                    <img
                      src={reply.authorImage}
                      alt=""
                      className="h-4 w-4 rounded-full"
                    />
                  )}
                  <span className="text-xs font-medium text-gray-600">
                    {reply.authorName || "Anonymous"}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {formatTimestamp(reply.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-gray-700">{reply.content}</p>
              </div>
            ))}

            {/* Reply input */}
            {!resolved && (
              <div onClick={(e) => e.stopPropagation()}>
                {replyingTo === markId ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Reply..."
                      className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          handleReplySubmit(markId, root[0]?.id);
                        if (e.key === "Escape") setReplyingTo(null);
                      }}
                    />
                    <button
                      onClick={() => handleReplySubmit(markId, root[0]?.id)}
                      className="text-xs font-medium text-indigo-600"
                    >
                      Send
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setReplyingTo(markId)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Reply
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Pending comment — at the bottom, after all threads */}
        {pendingComment && (
          <div
            ref={pendingContainerRef}
            className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-3 space-y-2"
          >
            <p className="text-xs font-medium text-yellow-700">New comment on:</p>
            <p className="text-xs italic text-gray-600 border-l-2 border-yellow-400 pl-2 line-clamp-2">
              &ldquo;{pendingComment.quotedText}&rdquo;
            </p>
            <div className="flex gap-2">
              <input
                ref={pendingRef}
                type="text"
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="Write your comment..."
                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-yellow-500 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePendingSubmit();
                  if (e.key === "Escape") onPendingCommentDone();
                }}
              />
              <button
                onClick={handlePendingSubmit}
                className="rounded bg-yellow-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-700"
              >
                Post
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
