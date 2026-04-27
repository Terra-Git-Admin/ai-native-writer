"use client";

import { useCallback, useEffect, useState } from "react";
import { clientTrace } from "@/lib/clientTrace";

interface Version {
  id: string;
  tabId: string | null;
  createdBy: string | null;
  createdAt: string;
  contentLen: number;
}

// How often to refetch the version list while the panel is open. Saves can
// create new version rows at any time (the server allows one snapshot per 5
// minutes per tab), and without polling the panel showed stale data — writers
// reported "the latest version history is at 1:06 PM" while the DB had a
// fresher row from a save at 1:32 PM. Bug repro: 27 Apr 2026.
const VERSION_LIST_POLL_MS = 15_000;

interface VersionHistoryProps {
  documentId: string;
  // Scope history to the active tab. Writers think per-tab, and tab-scoped
  // revert is the only safe default — a cross-tab revert would need to know
  // which tab to write to, which this panel doesn't.
  tabId: string | null;
  tabTitle?: string | null;
  onRevert: (content: string) => void;
  onClose: () => void;
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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function VersionHistory({
  documentId,
  tabId,
  tabTitle,
  onRevert,
  onClose,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);

  // Wrap the fetch so it can run on mount, on poll tick, and on manual click.
  // `silent=true` skips the loading flicker on background polls.
  const fetchVersions = useCallback(
    async (silent: boolean) => {
      if (!tabId) {
        setVersions([]);
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      else setRefreshing(true);
      try {
        const res = await fetch(
          `/api/documents/${documentId}/versions?tabId=${encodeURIComponent(tabId)}`
        );
        const data = await res.json();
        const list: Version[] = Array.isArray(data) ? data : [];
        setVersions(list);
        clientTrace("client.versionHistory.fetch.ok", {
          docId: documentId,
          docTabId: tabId,
          rowCount: list.length,
          latestCreatedAt: list[0]?.createdAt ?? null,
          silent,
        });
      } catch (err) {
        clientTrace("client.versionHistory.fetch.fail", {
          docId: documentId,
          docTabId: tabId,
          err: err instanceof Error ? err.message : String(err),
          silent,
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [documentId, tabId]
  );

  useEffect(() => {
    fetchVersions(false);
    if (!tabId) return;
    // Background poll while the panel is open. Stops on unmount or tab change.
    const handle = setInterval(() => fetchVersions(true), VERSION_LIST_POLL_MS);
    return () => clearInterval(handle);
  }, [fetchVersions, tabId]);

  const handleRevert = async (versionId: string) => {
    if (
      !confirm(
        `Replace this tab's current content with this saved version? Your current content will be snapshotted first, so you can come back to it from history.`
      )
    ) {
      return;
    }
    setReverting(versionId);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/revert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        }
      );
      if (res.ok) {
        const { content } = await res.json();
        onRevert(content);
      }
    } finally {
      setReverting(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h3 className="font-semibold">Version History</h3>
          {tabTitle && (
            <p className="text-xs text-gray-500">
              for tab: <span className="font-medium">{tabTitle}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              clientTrace("client.versionHistory.refresh.click", {
                docId: documentId,
                docTabId: tabId,
              });
              fetchVersions(false);
            }}
            disabled={loading || refreshing}
            title="Refresh version list"
            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && <p className="text-sm text-gray-500">Loading...</p>}

        {!loading && versions.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">
            No versions saved yet for this tab. A snapshot is taken
            automatically at most once every 5 minutes while you edit.
          </p>
        )}

        {versions.map((v, i) => (
          <div
            key={v.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50 transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-gray-800">
                {i === 0 ? "Latest version" : `Version ${versions.length - i}`}
              </p>
              <p className="text-xs text-gray-500">
                {formatTimestamp(v.createdAt)}
                <span className="ml-1 text-gray-400">
                  ({timeAgo(v.createdAt)})
                </span>
              </p>
              <p className="text-xs text-gray-400">
                {v.contentLen > 0
                  ? `${(v.contentLen / 1024).toFixed(1)} kb`
                  : "empty"}
                {v.createdBy ? ` • by ${v.createdBy}` : ""}
              </p>
            </div>
            <button
              onClick={() => handleRevert(v.id)}
              disabled={reverting !== null}
              className="rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {reverting === v.id ? "Reverting..." : "Revert this tab"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
