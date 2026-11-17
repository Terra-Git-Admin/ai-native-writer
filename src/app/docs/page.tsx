"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import PromptEditor from "@/components/settings/PromptEditor";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  orientationLabel,
  type DocumentOrientation,
} from "@/lib/document-orientation";
import { isPitchLabEnabledForClient } from "@/lib/pitch-lab-flags";

interface WriterDocument {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string | null;
  ownerImage: string | null;
  folderId: string | null;
  folderName: string | null;
  orientation: DocumentOrientation | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recentCommentCount: number;
}

interface WriterFolder {
  id: string;
  name: string;
  normalizedName: string;
}

type LibraryView =
  | { kind: "all" }
  | { kind: "archived" }
  | { kind: "folder"; folderId: string };

type OrganizationPatch = {
  folderId?: string | null;
  orientation?: DocumentOrientation;
  archived?: boolean;
};

type FolderDialogState =
  | { mode: "create" }
  | { mode: "rename"; folder: WriterFolder }
  | null;

function sortFolders(items: WriterFolder[]) {
  return [...items].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}
function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DocumentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pitchLabEnabled = isPitchLabEnabledForClient();
  const [docs, setDocs] = useState<WriterDocument[]>([]);
  const [folders, setFolders] = useState<WriterFolder[]>([]);
  const [view, setView] = useState<LibraryView>({ kind: "all" });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<WriterFolder | null>(null);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [documentsResponse, foldersResponse] = await Promise.all([
        fetch("/api/documents"),
        fetch("/api/folders"),
      ]);
      const [documentsData, foldersData] = await Promise.all([
        documentsResponse.json().catch(() => null),
        foldersResponse.json().catch(() => null),
      ]);
      if (!documentsResponse.ok) {
        throw new Error(documentsData?.error || "Could not load documents.");
      }
      if (!foldersResponse.ok) {
        throw new Error(foldersData?.error || "Could not load folders.");
      }
      if (!Array.isArray(documentsData) || !Array.isArray(foldersData)) {
        throw new Error("The document library returned an unexpected response.");
      }
      setDocs(documentsData);
      setFolders(sortFolders(foldersData));
    } catch (cause) {
      setDocs([]);
      setFolders([]);
      setLoadError(
        cause instanceof Error ? cause.message : "Could not load the document library."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    void loadLibrary();
  }, [loadLibrary, router, status]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const myDocs = useMemo(
    () => docs.filter((doc) => doc.ownerId === session?.user?.id),
    [docs, session?.user?.id]
  );
  const otherDocs = useMemo(
    () => docs.filter((doc) => doc.ownerId !== session?.user?.id && !doc.archivedAt),
    [docs, session?.user?.id]
  );
  const activeDocs = useMemo(
    () => myDocs.filter((doc) => !doc.archivedAt),
    [myDocs]
  );
  const archivedDocs = useMemo(
    () => myDocs.filter((doc) => Boolean(doc.archivedAt)),
    [myDocs]
  );
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    activeDocs.forEach((doc) => {
      if (doc.folderId) counts.set(doc.folderId, (counts.get(doc.folderId) || 0) + 1);
    });
    return counts;
  }, [activeDocs]);
  const visibleDocs = useMemo(() => {
    if (view.kind === "archived") return archivedDocs;
    if (view.kind === "folder") {
      return activeDocs.filter((doc) => doc.folderId === view.folderId);
    }
    return activeDocs;
  }, [activeDocs, archivedDocs, view]);

  const createDocument = async (orientation: DocumentOrientation) => {
    setCreateError(null);
    setCreating(true);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orientation }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        setCreateError(
          `Could not create document (HTTP ${response.status}). ${
            body.slice(0, 240) || "No response body."
          }`
        );
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { id?: string };
      if (!data.id) {
        setCreateError("Could not create document â€” the server returned no document id.");
        return;
      }
      setCreateDialogOpen(false);
      router.push(`/doc/${data.id}`);
    } catch (cause) {
      setCreateError(
        `Network error creating document: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
      );
    } finally {
      setCreating(false);
    }
  };

  const organizeDocument = async (
    id: string,
    changes: OrganizationPatch
  ): Promise<boolean> => {
    const previous = docs;
    const target = folders.find((folder) => folder.id === changes.folderId);
    setDocs((current) =>
      current.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              ...(changes.folderId !== undefined
                ? {
                    folderId: changes.folderId,
                    folderName: target?.name || null,
                  }
                : {}),
              ...(changes.orientation !== undefined
                ? { orientation: changes.orientation }
                : {}),
              ...(changes.archived !== undefined
                ? { archivedAt: changes.archived ? new Date().toISOString() : null }
                : {}),
            }
          : doc
      )
    );

    try {
      const response = await fetch(`/api/documents/${id}/organization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update document.");

      if (changes.folderId !== undefined) {
        setNotice(target ? `Moved to ${target.name}` : "Removed from folder");
      } else if (changes.orientation) {
        setNotice(`Changed format to ${orientationLabel(changes.orientation)}`);
      } else if (changes.archived !== undefined) {
        setNotice(changes.archived ? "Document archived" : "Document restored");
      }
      return true;
    } catch (cause) {
      setDocs(previous);
      setNotice(cause instanceof Error ? cause.message : "Could not update document.");
      return false;
    }
  };

  const saveFolder = async (name: string): Promise<string | null> => {
    if (!folderDialog) return "Folder action is no longer available.";
    const isRename = folderDialog.mode === "rename";
    const url = isRename ? `/api/folders/${folderDialog.folder.id}` : "/api/folders";
    try {
      const response = await fetch(url, {
        method: isRename ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return data.error || "Could not save folder.";

      if (isRename) {
        const folderId = folderDialog.folder.id;
        setFolders((current) =>
          sortFolders(
            current.map((folder) =>
              folder.id === folderId ? { ...folder, name: data.name || name } : folder
            )
          )
        );
        setDocs((current) =>
          current.map((doc) =>
            doc.folderId === folderId
              ? { ...doc, folderName: data.name || name }
              : doc
          )
        );
        setNotice("Folder renamed");
      } else {
        const folder = data as WriterFolder;
        setFolders((current) => sortFolders([...current, folder]));
        setView({ kind: "folder", folderId: folder.id });
        setNotice(`Created ${folder.name}`);
      }
      setFolderDialog(null);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Could not save folder.";
    }
  };

  const deleteFolder = async () => {
    if (!deleteFolderTarget) return;
    const folder = deleteFolderTarget;
    try {
      const response = await fetch(`/api/folders/${folder.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete folder.");
      setFolders((current) => current.filter((item) => item.id !== folder.id));
      setDocs((current) =>
        current.map((doc) =>
          doc.folderId === folder.id
            ? { ...doc, folderId: null, folderName: null }
            : doc
        )
      );
      if (view.kind === "folder" && view.folderId === folder.id) {
        setView({ kind: "all" });
      }
      setDeleteFolderTarget(null);
      setNotice(`Deleted ${folder.name}; its documents remain in All`);
    } catch (cause) {
      setDeleteFolderTarget(null);
      setNotice(cause instanceof Error ? cause.message : "Could not delete folder.");
    }
  };

  const folderDeleteCount = deleteFolderTarget
    ? activeDocs.filter((doc) => doc.folderId === deleteFolderTarget.id).length
    : 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <h1 className="text-xl font-bold">AI Writer</h1>
          <nav
            aria-label="Primary navigation"
            className="ml-4 flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap text-sm"
          >
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Home
            </Link>
            {pitchLabEnabled && (
              <Link
                href="/pitch-lab"
                className="text-muted-foreground hover:text-foreground"
              >
                Pitch Lab
              </Link>
            )}
            <ThemeToggle />
            <button
              onClick={() => setPromptsOpen(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              Prompts
            </button>
            {session?.user?.role === "admin" && (
              <Link href="/admin" className="text-muted-foreground hover:text-foreground">
                Admin
              </Link>
            )}
            <span className="hidden text-foreground md:inline">{session?.user?.name}</span>
            <button
              onClick={() => signOut()}
              className="text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      {promptsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            aria-label="Close prompts"
            className="absolute inset-0 bg-black/30"
            onClick={() => setPromptsOpen(false)}
          />
          <div className="relative h-full w-full max-w-[480px] bg-muted shadow-xl">
            <PromptEditor onClose={() => setPromptsOpen(false)} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Your Documents</h2>
            <button
              onClick={() => {
                setCreateError(null);
                setCreateDialogOpen(true);
              }}
              disabled={creating}
              className="min-h-10 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "Creatingâ€¦" : "+ New Document"}
            </button>
          </div>

          {createError && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <span className="flex-1">
                <strong>New document failed.</strong> {createError}
              </span>
              <button
                type="button"
                onClick={() => setCreateError(null)}
                className="rounded border border-red-200 bg-card px-2 py-1 font-medium dark:border-red-800"
              >
                Dismiss
              </button>
            </div>
          )}

          {loadError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              Could not load documents. {loadError}
            </div>
          )}

          {!loading && (
            <LibraryToolbar
              folders={folders}
              view={view}
              activeCount={activeDocs.length}
              archivedCount={archivedDocs.length}
              folderCounts={folderCounts}
              onSelect={setView}
              onCreate={() => setFolderDialog({ mode: "create" })}
              onRename={(folder) => setFolderDialog({ mode: "rename", folder })}
              onDelete={setDeleteFolderTarget}
            />
          )}

          {loading ? (
            <p className="py-8 text-sm text-muted-foreground">Loadingâ€¦</p>
          ) : visibleDocs.length === 0 ? (
            <LibraryEmptyState
              view={view}
              onCreateDocument={() => setCreateDialogOpen(true)}
            />
          ) : (
            <div className="mt-3 space-y-1">
              {visibleDocs.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  folders={folders}
                  onFolderSelect={(folderId) =>
                    setView({ kind: "folder", folderId })
                  }
                  onChange={(changes) => organizeDocument(doc.id, changes)}
                />
              ))}
            </div>
          )}
        </section>

        {!loading && view.kind === "all" && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">Other Documents</h2>
            {otherDocs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-10 text-center">
                <p className="text-muted-foreground">No shared documents yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {otherDocs.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} showOwner />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {createDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-document-title"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h2 id="create-document-title" className="text-lg font-semibold text-foreground">
              What are you writing?
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Choose a format. You can change it later without rewriting existing content.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void createDocument("portrait")}
                disabled={creating}
                className="min-h-28 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-indigo-950/30"
              >
                <span className="block font-semibold text-foreground">Portrait</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                  Vertical microdrama with short, cliffhanger-driven episodes.
                </span>
              </button>
              <button
                type="button"
                onClick={() => void createDocument("landscape")}
                disabled={creating}
                className="min-h-28 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-indigo-950/30"
              >
                <span className="block font-semibold text-foreground">Landscape</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                  Cinematic milestones that build into longer chapters.
                </span>
              </button>
            </div>

            {createError && (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                {createError}
              </p>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCreateDialogOpen(false)}
                disabled={creating}
                className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {folderDialog && (
        <FolderNameDialog
          title={folderDialog.mode === "rename" ? "Rename folder" : "New folder"}
          initialValue={folderDialog.mode === "rename" ? folderDialog.folder.name : ""}
          submitLabel={folderDialog.mode === "rename" ? "Save" : "Create"}
          onCancel={() => setFolderDialog(null)}
          onSave={saveFolder}
        />
      )}

      {deleteFolderTarget && (
        <DeleteFolderDialog
          folder={deleteFolderTarget}
          documentCount={folderDeleteCount}
          onCancel={() => setDeleteFolderTarget(null)}
          onConfirm={deleteFolder}
        />
      )}

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[70] max-w-sm rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground shadow-xl"
        >
          {notice}
        </div>
      )}
    </div>
  );
}

function LibraryToolbar({
  folders,
  view,
  activeCount,
  archivedCount,
  folderCounts,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  folders: WriterFolder[];
  view: LibraryView;
  activeCount: number;
  archivedCount: number;
  folderCounts: Map<string, number>;
  onSelect: (view: LibraryView) => void;
  onCreate: () => void;
  onRename: (folder: WriterFolder) => void;
  onDelete: (folder: WriterFolder) => void;
}) {
  return (
    <div className="border-b border-border pb-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Folders
        </h3>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New folder
        </button>
      </div>
      <FolderChipBar
        folders={folders}
        view={view}
        activeCount={activeCount}
        archivedCount={archivedCount}
        folderCounts={folderCounts}
        onSelect={onSelect}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

function ViewButton({
  active,
  label,
  count,
  onClick,
  title,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      data-library-chip
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`inline-flex min-h-9 max-w-[180px] items-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        active
          ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="ml-1.5 text-xs tabular-nums opacity-75">{count}</span>
    </button>
  );
}

function FolderChipBar({
  folders,
  view,
  activeCount,
  archivedCount,
  folderCounts,
  onSelect,
  onRename,
  onDelete,
}: {
  folders: WriterFolder[];
  view: LibraryView;
  activeCount: number;
  archivedCount: number;
  folderCounts: Map<string, number>;
  onSelect: (view: LibraryView) => void;
  onRename: (folder: WriterFolder) => void;
  onDelete: (folder: WriterFolder) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(folders.length);
  const activeFolder =
    view.kind === "folder" ? folders.find((folder) => folder.id === view.folderId) : null;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisibleCount(folders.length));
    return () => cancelAnimationFrame(frame);
  }, [folders, view]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let width = container.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(entry.contentRect.width);
      if (nextWidth !== width) {
        width = nextWidth;
        setVisibleCount(folders.length);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [folders.length]);

  const visibleFolders = useMemo(() => {
    const next = folders.slice(0, visibleCount);
    if (
      activeFolder &&
      next.length > 0 &&
      !next.some((folder) => folder.id === activeFolder.id)
    ) {
      next[next.length - 1] = activeFolder;
    }
    return next;
  }, [activeFolder, folders, visibleCount]);
  const visibleIds = useMemo(
    () => new Set(visibleFolders.map((folder) => folder.id)),
    [visibleFolders]
  );
  const overflowFolders = folders.filter((folder) => !visibleIds.has(folder.id));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || visibleCount <= 1) return;
    const chips = Array.from(
      container.querySelectorAll<HTMLElement>("[data-library-chip]")
    );
    const rowTops = [...new Set(chips.map((chip) => chip.offsetTop))].sort(
      (left, right) => left - right
    );
    if (rowTops.length > 2) {
      const chipsBeyondSecondRow = chips.filter(
        (chip) => chip.offsetTop > rowTops[1]
      ).length;
      const frame = requestAnimationFrame(() =>
        setVisibleCount((current) =>
          Math.max(1, current - Math.max(1, chipsBeyondSecondRow))
        )
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [overflowFolders.length, visibleCount, visibleFolders]);

  return (
    <div ref={containerRef} className="flex min-w-0 flex-wrap items-center gap-2">
      <ViewButton
        active={view.kind === "all"}
        label="All"
        count={activeCount}
        onClick={() => onSelect({ kind: "all" })}
      />
      <ViewButton
        active={view.kind === "archived"}
        label="Archived"
        count={archivedCount}
        onClick={() => onSelect({ kind: "archived" })}
      />
      {folders.length > 0 && (
        <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden="true" />
      )}
      {visibleFolders.map((folder) => (
        <ViewButton
          key={folder.id}
          active={view.kind === "folder" && view.folderId === folder.id}
          label={folder.name}
          title={folder.name}
          count={folderCounts.get(folder.id) || 0}
          onClick={() => onSelect({ kind: "folder", folderId: folder.id })}
        />
      ))}
      {folders.length > 0 && (
        <FolderOverflowMenu
          overflowFolders={overflowFolders}
          allFolders={folders}
          view={view}
          folderCounts={folderCounts}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function FolderOverflowMenu({
  overflowFolders,
  allFolders,
  view,
  folderCounts,
  onSelect,
  onRename,
  onDelete,
}: {
  overflowFolders: WriterFolder[];
  allFolders: WriterFolder[];
  view: LibraryView;
  folderCounts: Map<string, number>;
  onSelect: (view: LibraryView) => void;
  onRename: (folder: WriterFolder) => void;
  onDelete: (folder: WriterFolder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const source = managing ? allFolders : overflowFolders;
  const filtered = source.filter((folder) =>
    folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const showSearch = source.length > 8;

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setManaging(false);
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (managing && overflowFolders.length > 0) {
        setManaging(false);
        setQuery("");
      } else {
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    if (showSearch) requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, managing, open, overflowFolders.length, showSearch]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        data-library-chip
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          setManaging(nextOpen && overflowFolders.length === 0);
          setQuery("");
        }}
        className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {overflowFolders.length > 0 ? `+ More ${overflowFolders.length}` : "Manage"}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(330px,calc(100vw-32px))] rounded-lg border border-border bg-card p-2 shadow-2xl">
          <div className="mb-2 flex min-h-9 items-center border-b border-border pb-2">
            {managing && overflowFolders.length > 0 && (
              <button
                type="button"
                aria-label="Back to more folders"
                onClick={() => {
                  setManaging(false);
                  setQuery("");
                }}
                className="mr-1 grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <span className="px-1 text-sm font-semibold text-foreground">
              {managing ? "Manage folders" : "More folders"}
            </span>
          </div>

          {showSearch && (
            <label className="relative mb-2 block">
              <span className="sr-only">Search folders</span>
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search folders"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          )}

          <div className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No folders found
              </p>
            ) : (
              filtered.map((folder) => {
                const selected = view.kind === "folder" && view.folderId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={`flex min-h-10 items-center rounded-md ${
                      selected ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-muted"
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onSelect({ kind: "folder", folderId: folder.id });
                        close();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2 text-left text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {folderCounts.get(folder.id) || 0}
                      </span>
                      {selected && (
                        <Check className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                      )}
                    </button>
                    {managing && (
                      <>
                        <button
                          type="button"
                          aria-label={`Rename ${folder.name}`}
                          onClick={() => {
                            close();
                            onRename(folder);
                          }}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded text-muted-foreground opacity-70 hover:bg-background hover:text-foreground focus:opacity-100"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${folder.name}`}
                          onClick={() => {
                            close();
                            onDelete(folder);
                          }}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded text-muted-foreground opacity-70 hover:bg-red-950/30 hover:text-red-400 focus:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {!managing && (
            <button
              type="button"
              onClick={() => {
                setManaging(true);
                setQuery("");
              }}
              className="mt-2 flex min-h-10 w-full items-center border-t border-border px-2 pt-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Manage folders
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LibraryEmptyState({
  view,
  onCreateDocument,
}: {
  view: LibraryView;
  onCreateDocument: () => void;
}) {
  const copy =
    view.kind === "archived"
      ? "Archived documents will appear here."
      : view.kind === "folder"
        ? "There are no documents in this folder."
        : "No documents yet.";
  return (
    <div className="mt-3 rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm text-muted-foreground">{copy}</p>
      {view.kind !== "archived" && (
        <button
          type="button"
          onClick={onCreateDocument}
          className="mt-2 min-h-10 px-3 text-sm font-medium text-indigo-400 hover:text-indigo-300"
        >
          Create a document
        </button>
      )}
    </div>
  );
}

function DocumentRow({
  doc,
  folders = [],
  showOwner = false,
  onFolderSelect,
  onChange,
}: {
  doc: WriterDocument;
  folders?: WriterFolder[];
  showOwner?: boolean;
  onFolderSelect?: (folderId: string) => void;
  onChange?: (changes: OrganizationPatch) => Promise<boolean>;
}) {
  return (
    <article className="group relative flex min-h-16 items-center rounded-lg px-4 py-3 transition-colors hover:bg-muted/70 focus-within:bg-muted/70">
      <div className="min-w-0 flex-1 pr-2">
        <Link href={`/doc/${doc.id}`} className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold leading-5 text-foreground">
            {doc.title || "Untitled"}
          </p>
          {doc.recentCommentCount > 0 && (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 px-1.5 text-xs font-bold text-white">
              {doc.recentCommentCount}
            </span>
          )}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[18px] text-muted-foreground">
          <span>Updated {formatDate(doc.updatedAt)}</span>
          {doc.folderName && doc.folderId && onFolderSelect ? (
            <button
              type="button"
              onClick={() => onFolderSelect(doc.folderId as string)}
              title={`Show ${doc.folderName}`}
              className="inline-flex min-h-6 min-w-0 items-center rounded px-1 -mx-1 hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <span className="truncate">{doc.folderName}</span>
            </button>
          ) : doc.folderName ? (
            <span className="inline-flex min-w-0 items-center">
              <span className="truncate">{doc.folderName}</span>
            </span>
          ) : null}
          <span>
            {doc.orientation ? orientationLabel(doc.orientation) : "No format"}
          </span>
          {showOwner && <span>{doc.ownerName || "Unknown owner"}</span>}
        </div>
      </div>

      {onChange && (
        <DocumentActions doc={doc} folders={folders} onChange={onChange} />
      )}
    </article>
  );
}

function DocumentActions({
  doc,
  folders,
  onChange,
}: {
  doc: WriterDocument;
  folders: WriterFolder[];
  onChange: (changes: OrganizationPatch) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"root" | "folder" | "format">("root");
  const [query, setQuery] = useState("");
  const [opensUp, setOpensUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = folders.length > 8;
  const filteredFolders = folders.filter((folder) =>
    folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setPanel("root");
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (panel !== "root") {
        setPanel("root");
      } else {
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open, panel]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (panel === "folder" && showSearch) searchRef.current?.focus();
      else menuRef.current?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus();
    });
  }, [open, panel, showSearch]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    setOpensUp(Boolean(rect && window.innerHeight - rect.bottom < 370 && rect.top > 370));
    setOpen(true);
  };

  const apply = async (changes: OrganizationPatch) => {
    setSaving(true);
    const succeeded = await onChange(changes);
    setSaving(false);
    if (succeeded) close(true);
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Organize ${doc.title || "Untitled"}`}
        aria-expanded={open}
        onClick={toggle}
        className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-background hover:text-foreground hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          aria-label={`Organize ${doc.title || "Untitled"}`}
          className={`absolute right-0 z-50 w-[min(288px,calc(100vw-32px))] rounded-lg border border-border bg-card p-2 shadow-2xl ${
            opensUp ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"
          }`}
        >
          {panel === "root" && (
            <>
              <MenuAction
                autoFocus
                icon={<FolderOpen className="h-4 w-4" aria-hidden="true" />}
                label="Move to folder"
                value={doc.folderName || "No folder"}
                onClick={() => setPanel("folder")}
              />
              <MenuAction
                icon={
                  doc.orientation === "landscape" ? (
                    <RectangleHorizontal className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <RectangleVertical className="h-4 w-4" aria-hidden="true" />
                  )
                }
                label="Change format"
                value={doc.orientation ? orientationLabel(doc.orientation) : "No format"}
                onClick={() => setPanel("format")}
              />
              <div className="my-2 h-px bg-border" />
              <button
                type="button"
                disabled={saving}
                onClick={() => void apply({ archived: !doc.archivedAt })}
                className={`flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm disabled:opacity-50 ${
                  doc.archivedAt
                    ? "text-foreground hover:bg-muted"
                    : "text-red-400 hover:bg-red-950/30"
                }`}
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                {doc.archivedAt ? "Restore document" : "Archive document"}
              </button>
            </>
          )}

          {panel === "folder" && (
            <>
              <PanelHeader label="Move to folder" onBack={() => setPanel("root")} />
              {showSearch && (
                <label className="relative mb-2 block">
                  <span className="sr-only">Search folders</span>
                  <Search
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search folders"
                    className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              )}
              <button
                type="button"
                data-autofocus={!showSearch || undefined}
                disabled={saving}
                onClick={() => void apply({ folderId: null })}
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">No folder</span>
                {!doc.folderId && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />}
              </button>
              <div className="my-1 h-px bg-border" />
              <div className="max-h-60 overflow-y-auto overscroll-contain">
                {filteredFolders.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No folders found
                  </p>
                ) : (
                  filteredFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      disabled={saving}
                      onClick={() => void apply({ folderId: folder.id })}
                      className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      {doc.folderId === folder.id && (
                        <Check className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {panel === "format" && (
            <>
              <PanelHeader label="Change format" onBack={() => setPanel("root")} />
              {(["portrait", "landscape"] as const).map((orientation, index) => (
                <button
                  key={orientation}
                  type="button"
                  data-autofocus={index === 0 || undefined}
                  disabled={saving}
                  onClick={() => void apply({ orientation })}
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {orientation === "portrait" ? (
                    <RectangleVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <RectangleHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="flex-1">{orientationLabel(orientation)}</span>
                  {doc.orientation === orientation && (
                    <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuAction({
  icon,
  label,
  value,
  autoFocus = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  autoFocus?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-autofocus={autoFocus || undefined}
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-2 rounded-md px-3 text-left hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function PanelHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="mb-2 flex min-h-10 items-center border-b border-border pb-2">
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </div>
  );
}

function FolderNameDialog({
  title,
  initialValue,
  submitLabel,
  onCancel,
  onSave,
}: {
  title: string;
  initialValue: string;
  submitLabel: string;
  onCancel: () => void;
  onSave: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const nextError = await onSave(name);
    setSaving(false);
    setError(nextError);
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-dialog-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl"
      >
        <h3 id="folder-dialog-title" className="text-lg font-semibold">
          {title}
        </h3>
        <label className="mt-4 block text-sm font-medium text-foreground">
          Folder name
          <input
            ref={inputRef}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="min-h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="min-h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Savingâ€¦" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteFolderDialog({
  folder,
  documentCount,
  onCancel,
  onConfirm,
}: {
  folder: WriterFolder;
  documentCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-folder-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl">
        <h3 id="delete-folder-title" className="text-lg font-semibold">
          Delete â€œ{folder.name}â€?
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {documentCount} document{documentCount === 1 ? "" : "s"} will remain in All
          without a folder.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="min-h-10 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-10 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500"
          >
            Delete folder
          </button>
        </div>
      </div>
    </div>
  );
}

