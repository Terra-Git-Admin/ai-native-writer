"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PromptEditor from "@/components/settings/PromptEditor";

interface Document {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string | null;
  ownerImage: string | null;
  createdAt: string;
  updatedAt: string;
  recentCommentCount: number;
}

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleteStats, setDeleteStats] = useState<{
    words: number;
    lines: number;
  } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((data) => {
        setDocs(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const myDocs = docs.filter((d) => d.ownerId === session?.user?.id);
  const otherDocs = docs.filter((d) => d.ownerId !== session?.user?.id);

  // Doc creation must NEVER silently fail. The previous version destructured
  // `id` from the response without checking res.ok — when POST returned
  // 500 (e.g. due to a DB write failure), `id` was undefined and the user
  // got navigated to /doc/undefined which then redirected back to /. That
  // looked like "the new-document button doesn't work" and was invisible
  // for hours. Surface the real error.
  const createDocument = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setCreateError(
          `Could not create document (HTTP ${res.status}). ${body.slice(0, 240) || "No response body."}`
        );
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      if (!data.id) {
        setCreateError(
          "Could not create document — server returned a 200 with no document id. Check Cloud Run logs."
        );
        return;
      }
      router.push(`/doc/${data.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(`Network error creating document: ${msg}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = async (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;
    setDeleteTarget({ id: docId, title: doc.title || "Untitled" });
    setDeleteStats(null);
    // Fetch doc content to compute stats
    try {
      const res = await fetch(`/api/documents/${docId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.content) {
          const json = JSON.parse(data.content);
          const text = extractTextFromTiptap(json);
          const words = text
            .split(/\s+/)
            .filter((w: string) => w.length > 0).length;
          const lines = text.split("\n").filter((l: string) => l.trim()).length;
          setDeleteStats({ words, lines });
        } else {
          setDeleteStats({ words: 0, lines: 0 });
        }
      }
    } catch {
      // ignore — stats are optional
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/documents/${deleteTarget.id}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleteStats(null);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold">AI Writer</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPromptsOpen(!promptsOpen)}
              className={`text-sm ${promptsOpen ? "text-gray-900 font-medium" : "text-gray-500 hover:text-gray-900"}`}
            >
              Prompts
            </button>
            {session?.user?.role === "admin" && (
              <Link
                href="/admin"
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                Admin
              </Link>
            )}
            <div className="flex items-center gap-2">
              {session?.user?.image && (
                <img
                  src={session.user.image}
                  alt=""
                  className="h-7 w-7 rounded-full"
                />
              )}
              <span className="text-sm text-gray-700">
                {session?.user?.name}
              </span>
            </div>
            <button
              onClick={() => signOut()}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <DeleteConfirmDialog
          docTitle={deleteTarget.title}
          stats={deleteStats}
          onConfirm={confirmDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteStats(null);
          }}
        />
      )}

      {/* Prompts slide-over */}
      {promptsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setPromptsOpen(false)}
          />
          <div className="relative w-[480px] bg-gray-50 shadow-xl h-full">
            <PromptEditor onClose={() => setPromptsOpen(false)} />
          </div>
        </div>
      )}

      {/* Content */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <>
            {/* Your Documents */}
            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Your Documents</h2>
                <button
                  onClick={createDocument}
                  disabled={creating}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {creating ? "Creating..." : "+ New Document"}
                </button>
              </div>

              {createError && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <span className="flex-1">
                    <strong>New document failed.</strong> {createError}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCreateError(null)}
                    className="rounded bg-white border border-red-200 px-2 py-1 font-medium hover:bg-red-100 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {myDocs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center">
                  <p className="text-gray-500">No documents yet</p>
                  <button
                    onClick={createDocument}
                    disabled={creating}
                    className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-60"
                  >
                    {creating ? "Creating..." : "Create your first document"}
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {myDocs.map((doc) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      formatDate={formatDate}
                      isOwner
                      onDelete={handleDeleteClick}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Other Documents */}
            <section>
              <h2 className="mb-4 text-lg font-semibold">Other Documents</h2>

              {otherDocs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center">
                  <p className="text-gray-500">No shared documents yet</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {otherDocs.map((doc) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      formatDate={formatDate}
                      showOwner
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function DocRow({
  doc,
  formatDate,
  showOwner,
  isOwner,
  onDelete,
}: {
  doc: Document;
  formatDate: (d: string) => string;
  showOwner?: boolean;
  isOwner?: boolean;
  onDelete?: (docId: string) => void;
}) {
  return (
    <div className="flex items-center rounded-lg px-4 py-3 hover:bg-gray-50 transition-colors group">
      <Link
        href={`/doc/${doc.id}`}
        className="flex flex-1 items-center justify-between min-w-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{doc.title || "Untitled"}</p>
              {doc.recentCommentCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-xs font-bold text-white">
                  {doc.recentCommentCount}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              Updated {formatDate(doc.updatedAt)}
            </p>
          </div>
        </div>

        {showOwner && (
          <div className="ml-4 flex shrink-0 items-center gap-2">
            {doc.ownerImage && (
              <img
                src={doc.ownerImage}
                alt=""
                className="h-5 w-5 rounded-full"
              />
            )}
            <span className="text-sm text-gray-500">
              {doc.ownerName || "Unknown"}
            </span>
          </div>
        )}
      </Link>

      {isOwner && onDelete && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(doc.id);
          }}
          className="ml-2 shrink-0 rounded p-1.5 text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-all"
          title="Delete document"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

function DeleteConfirmDialog({
  docTitle,
  stats,
  onConfirm,
  onCancel,
}: {
  docTitle: string;
  stats: { words: number; lines: number } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Delete document?</h3>
        <p className="mt-2 text-sm text-gray-600">
          Are you sure you want to delete{" "}
          <span className="font-medium">&ldquo;{docTitle}&rdquo;</span>?
          This cannot be undone.
        </p>
        {stats && (
          <div className="mt-3 flex gap-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
            <span>{stats.words.toLocaleString()} words</span>
            <span>{stats.lines.toLocaleString()} lines</span>
          </div>
        )}
        <div className="mt-5 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function extractTextFromTiptap(node: Record<string, unknown>): string {
  if (node.type === "text") return (node.text as string) || "";
  const children = (node.content as Record<string, unknown>[]) || [];
  const texts = children.map(extractTextFromTiptap);
  if (
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "blockquote"
  ) {
    return texts.join("") + "\n";
  }
  if (node.type === "listItem") {
    return texts.join("") + "\n";
  }
  return texts.join("");
}
