"use client";

import { useState, useRef, useEffect, useMemo } from "react";

export type TabType =
  | "custom"
  | "series_overview"
  | "characters"
  | "episode_plot"
  | "reference_episode"
  | "research";

export interface TabRow {
  id: string;
  title: string;
  type: TabType;
  sequenceNumber: number | null;
  position: number;
  content: string | null;
  updatedAt: string | Date;
}

const TYPE_BADGES: Record<TabType, { label: string; className: string }> = {
  custom: { label: "Tab", className: "bg-gray-100 text-gray-600" },
  series_overview: { label: "Overview", className: "bg-purple-100 text-purple-700" },
  characters: { label: "Chars", className: "bg-blue-100 text-blue-700" },
  episode_plot: { label: "Plots", className: "bg-amber-100 text-amber-700" },
  reference_episode: { label: "Ref Ep", className: "bg-green-100 text-green-700" },
  research: { label: "Research", className: "bg-pink-100 text-pink-700" },
};

const isArchive = (title: string) => /\(archive\)/i.test(title);

// Parse a tab's Tiptap JSON content for its outline. Returns every heading
// (H1/H2/H3) the writer has placed inside the tab body, so the rail outline
// reflects whatever structure the writer has built — not just H3.
//
// The FIRST heading is skipped when it's level 1, since the splitter (and
// the writer's natural habit) puts the tab's title as the first H1. Showing
// it as an outline item would duplicate the tab row itself.
interface OutlineHeading {
  text: string;
  level: 1 | 2 | 3;
  order: number;
}

interface TiptapNode {
  type?: string;
  attrs?: { level?: number };
  content?: TiptapNode[];
  text?: string;
}

function extractOutlineFromContent(contentStr: string | null): OutlineHeading[] {
  if (!contentStr) return [];
  let doc: TiptapNode;
  try {
    doc = JSON.parse(contentStr);
  } catch {
    return [];
  }
  const raw: OutlineHeading[] = [];
  const textOf = (n: TiptapNode): string => {
    if (typeof n.text === "string") return n.text;
    if (!n.content) return "";
    return n.content.map(textOf).join("");
  };
  const walk = (n: TiptapNode) => {
    if (n.type === "heading") {
      const level = (n.attrs?.level ?? 1) as 1 | 2 | 3;
      if (level >= 1 && level <= 3) {
        const t = textOf(n).trim();
        if (t) raw.push({ text: t, level, order: raw.length });
      }
    }
    if (n.content) for (const c of n.content) walk(c);
  };
  if (doc.content) for (const c of doc.content) walk(c);
  return skipTitleH1(raw);
}

// Drop a leading level-1 heading — that's the tab title, already shown as
// the tab row itself. Everything after it is the real outline.
function skipTitleH1(headings: OutlineHeading[]): OutlineHeading[] {
  if (headings.length > 0 && headings[0].level === 1) {
    return headings.slice(1).map((h, i) => ({ ...h, order: i }));
  }
  return headings.map((h, i) => ({ ...h, order: i }));
}

interface CommentRow {
  id: string;
  tabId: string | null;
  resolved: boolean;
  parentId: string | null;
}

// The editor emits these on every transaction — we need them for the active
// tab so newly-typed [H3] headings show up in the rail instantly without
// waiting for a tabs-refetch from the DB.
interface LiveHeading {
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

interface Props {
  documentId: string;
  tabs: TabRow[];
  activeTabId: string;
  // Live heading stream from the active tab's editor (all levels). TabRail
  // filters to level 3 for the nested outline.
  activeTabHeadings?: LiveHeading[];
  isOwner: boolean;
  // When the writer clicks a nested sub-item, the rail asks the parent to
  // switch tabs AND (once the editor is mounted) scroll to that H3 by text.
  onSwitch: (tabId: string, scrollToHeadingText?: string) => void;
  onTabsChange: () => void;
}

export default function TabRail({
  documentId,
  tabs,
  activeTabId,
  activeTabHeadings,
  isOwner,
  onSwitch,
  onTabsChange,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const createTitleRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCreate) setTimeout(() => createTitleRef.current?.focus(), 50);
  }, [showCreate]);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameRef.current?.focus(), 50);
  }, [renamingId]);

  // Fetch unresolved comment counts per tab. Lightweight — one fetch.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/comments?documentId=${documentId}`);
        if (!res.ok) return;
        const rows: CommentRow[] = await res.json();
        const counts: Record<string, number> = {};
        for (const c of rows) {
          if (c.parentId || c.resolved) continue;
          if (!c.tabId) continue;
          counts[c.tabId] = (counts[c.tabId] || 0) + 1;
        }
        setCommentCounts(counts);
      } catch {
        /* ignore */
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [documentId]);

  // Sort: archive always first, then by position.
  const sortedTabs = useMemo(
    () =>
      [...tabs].sort((a, b) => {
        const aPinned = isArchive(a.title);
        const bPinned = isArchive(b.title);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return a.position - b.position;
      }),
    [tabs]
  );

  const handleCreate = async () => {
    if (creating) return;
    const title = createTitle.trim() || "Untitled";
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/tabs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCreateError(data.error || `Create failed (HTTP ${res.status})`);
        return;
      }
      const newTab = await res.json();
      setShowCreate(false);
      setCreateTitle("");
      onTabsChange();
      setTimeout(() => onSwitch(newTab.id), 30);
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (tabId: string) => {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/documents/${documentId}/tabs/${tabId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setRenamingId(null);
    setRenameValue("");
    onTabsChange();
  };

  const handleDelete = async (tabId: string, title: string) => {
    const msg = isArchive(title)
      ? `Delete the archive tab "${title}"?\n\nThis is your safety-net copy of the original document. Once deleted it cannot be recovered.`
      : `Delete tab "${title}"?\n\nThis removes the tab's content and all comments in it.`;
    if (!confirm(msg)) return;
    const res = await fetch(`/api/documents/${documentId}/tabs/${tabId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Delete failed");
      return;
    }
    if (tabId === activeTabId) {
      const remaining = sortedTabs.filter((t) => t.id !== tabId);
      if (remaining[0]) onSwitch(remaining[0].id);
    }
    onTabsChange();
  };

  const toggleCollapse = (tabId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  };

  // Drag reorder — only within the non-pinned (non-archive) tabs. Dropping
  // onto any non-archive parent moves the dragged tab to that position.
  const commitReorder = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    // Build the new order: remove dragged, insert before target.
    const ids = sortedTabs.map((t) => t.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    const adjusted = toIdx > fromIdx ? toIdx - 1 : toIdx;
    ids.splice(adjusted, 0, draggedId);
    // Never let a non-archive tab end up above the archive: force archive(s) first.
    const pinned = ids.filter((id) => {
      const t = sortedTabs.find((x) => x.id === id);
      return t && isArchive(t.title);
    });
    const rest = ids.filter((id) => !pinned.includes(id));
    const finalOrder = [...pinned, ...rest];

    await fetch(`/api/documents/${documentId}/tabs/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: finalOrder }),
    });
    onTabsChange();
  };

  // Resolve the outline headings for a tab — all levels, across every
  // formatting rule the writer might have used. For the active tab, prefer
  // the live stream from the editor so the outline updates as the writer
  // types. For other tabs, fall back to parsing the last-fetched content.
  const headingsForTab = (tab: TabRow): OutlineHeading[] => {
    if (tab.id === activeTabId && activeTabHeadings) {
      const raw: OutlineHeading[] = activeTabHeadings.map((h, i) => ({
        text: h.text,
        level: h.level,
        order: i,
      }));
      return skipTitleH1(raw);
    }
    return extractOutlineFromContent(tab.content);
  };

  // Indentation per heading level so the outline reads as a tree. H1s live
  // at the top level, H2 children indent once, H3 twice.
  const LEVEL_INDENT: Record<1 | 2 | 3, string> = {
    1: "pl-3",
    2: "pl-6",
    3: "pl-9",
  };
  const LEVEL_TEXT: Record<1 | 2 | 3, string> = {
    1: "text-[12px] font-medium text-gray-700",
    2: "text-[12px] text-gray-600",
    3: "text-[11px] text-gray-500",
  };

  const renderSubItems = (tab: TabRow) => {
    const headings = headingsForTab(tab);
    if (headings.length === 0) return null;
    return (
      <ul className="ml-5 border-l border-gray-200">
        {headings.map((h) => (
          <li key={`${tab.id}::${h.order}::${h.level}`}>
            <button
              type="button"
              onClick={() => onSwitch(tab.id, h.text)}
              className={`block w-full text-left py-1 pr-2 hover:bg-gray-100 hover:text-gray-900 truncate ${LEVEL_INDENT[h.level]} ${LEVEL_TEXT[h.level]}`}
              title={h.text}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="w-60 flex-shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Tabs
        </span>
      </div>

      <nav className="py-1 flex-1">
        {sortedTabs.map((tab) => {
          const active = tab.id === activeTabId;
          const badge = TYPE_BADGES[tab.type];
          const pinned = isArchive(tab.title);
          // Any non-archive tab with headings inside gets a nested outline.
          // No more allow-list by type — if the writer adds structure, the
          // rail reflects it.
          const outlineHeadings = pinned ? [] : headingsForTab(tab);
          const hasNested = outlineHeadings.length > 0;
          const subItemCount = outlineHeadings.length;
          const collapsed = collapsedParents.has(tab.id);
          const count = commentCounts[tab.id] || 0;

          if (renamingId === tab.id) {
            return (
              <div key={tab.id} className="px-2 py-1">
                <input
                  ref={renameRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(tab.id);
                    if (e.key === "Escape") {
                      setRenamingId(null);
                      setRenameValue("");
                    }
                  }}
                  className="w-full rounded border border-indigo-400 px-2 py-1 text-sm focus:outline-none"
                />
              </div>
            );
          }

          const isDropTarget = dropTargetId === tab.id && dragId && dragId !== tab.id;

          return (
            <div key={tab.id}>
              <div
                draggable={isOwner && !pinned}
                onDragStart={() => setDragId(tab.id)}
                onDragOver={(e) => {
                  if (!dragId || dragId === tab.id || pinned) return;
                  e.preventDefault();
                  setDropTargetId(tab.id);
                }}
                onDragLeave={() => {
                  if (dropTargetId === tab.id) setDropTargetId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== tab.id) commitReorder(dragId, tab.id);
                  setDragId(null);
                  setDropTargetId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTargetId(null);
                }}
                className={`group flex items-center transition-colors ${
                  active ? "bg-indigo-100" : "hover:bg-gray-100"
                } ${isDropTarget ? "border-t-2 border-indigo-500" : ""} ${
                  dragId === tab.id ? "opacity-50" : ""
                } ${pinned ? "border-b border-dashed border-gray-300" : ""}`}
              >
                {hasNested && subItemCount > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(tab.id);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-700"
                    aria-label={collapsed ? "Expand" : "Collapse"}
                    title={collapsed ? "Expand" : "Collapse"}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 120ms",
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-[19px]" /> // keep left margin aligned
                )}

                <button
                  type="button"
                  onClick={() => onSwitch(tab.id)}
                  onDoubleClick={() => {
                    if (!isOwner) return;
                    setRenameValue(tab.title);
                    setRenamingId(tab.id);
                  }}
                  className={`flex-1 min-w-0 text-left truncate py-2 pr-1 text-sm ${
                    active ? "text-indigo-800 font-medium" : "text-gray-700"
                  } ${pinned ? "italic text-gray-500" : ""}`}
                  title={`${tab.title} (double-click to rename)`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${badge.className}`}
                    >
                      {pinned ? "Archive" : badge.label}
                    </span>
                    <span className="truncate">{tab.title}</span>
                    {count > 0 && (
                      <span
                        className="flex-shrink-0 rounded-full bg-yellow-400 px-1.5 text-[10px] font-semibold text-yellow-900"
                        title={`${count} unresolved comment${count === 1 ? "" : "s"}`}
                      >
                        {count}
                      </span>
                    )}
                  </div>
                </button>

                {isOwner && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(tab.id, tab.title);
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                    title="Delete"
                    aria-label="Delete tab"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
              {hasNested && !collapsed && renderSubItems(tab)}
            </div>
          );
        })}
      </nav>

      {isOwner && (
        <div className="border-t border-gray-200 p-2">
          {showCreate ? (
            <div className="space-y-2">
              <input
                ref={createTitleRef}
                type="text"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="New tab name"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setShowCreate(false);
                    setCreateTitle("");
                    setCreateError(null);
                  }
                }}
              />
              {createError && (
                <p className="text-[11px] text-red-600">{createError}</p>
              )}
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setCreateTitle("");
                    setCreateError(null);
                  }}
                  className="flex-1 rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full rounded border border-dashed border-gray-300 px-2 py-2 text-sm text-gray-600 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              + New tab
            </button>
          )}
        </div>
      )}
    </div>
  );
}
