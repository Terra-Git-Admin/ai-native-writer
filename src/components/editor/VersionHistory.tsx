"use client";

import { useEffect, useState } from "react";

interface Version {
  id: string;
  tabId: string | null;
  createdBy: string | null;
  createdAt: string;
  contentLen: number;
}

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
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    if (!tabId) {
      setVersions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(
      `/api/documents/${documentId}/versions?tabId=${encodeURIComponent(tabId)}`
    )
      .then((r) => r.json())
      .then((data) => {
        setVersions(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [documentId, tabId]);

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
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          &times;
        </button>
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
