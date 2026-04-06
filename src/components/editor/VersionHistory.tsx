"use client";

import { useEffect, useState } from "react";

interface Version {
  id: string;
  createdBy: string | null;
  createdAt: string;
}

interface VersionHistoryProps {
  documentId: string;
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
  onRevert,
  onClose,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/documents/${documentId}/versions`)
      .then((r) => r.json())
      .then((data) => {
        setVersions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [documentId]);

  const handleRevert = async (versionId: string) => {
    if (!confirm("Revert to this version? Current content will be saved as a version first.")) {
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
        <h3 className="font-semibold">Version History</h3>
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
            No versions saved yet. Versions are created automatically every 5
            minutes when you edit.
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
              {v.createdBy && (
                <p className="text-xs text-gray-400">by {v.createdBy}</p>
              )}
            </div>
            <button
              onClick={() => handleRevert(v.id)}
              disabled={reverting !== null}
              className="rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {reverting === v.id ? "Reverting..." : "Revert"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
