"use client";

import { useState } from "react";
import type { TabRow } from "@/components/editor/TabRail";

interface QualityAgentModalProps {
  tabs: TabRow[];
  currentTabId: string;
  onConfirm: (tabId: string, label: string) => void;
  onCancel: () => void;
}

export default function QualityAgentModal({
  tabs,
  currentTabId,
  onConfirm,
  onCancel,
}: QualityAgentModalProps) {
  const episodeTabs = tabs
    .filter((t) => t.type === "predefined_episodes")
    .sort((a, b) => {
      const aSeq = a.sequenceNumber ?? a.position;
      const bSeq = b.sequenceNumber ?? b.position;
      return aSeq - bSeq;
    });

  const defaultId =
    episodeTabs.find((t) => t.id === currentTabId)?.id ??
    episodeTabs[episodeTabs.length - 1]?.id ??
    "";

  const [selectedId, setSelectedId] = useState(defaultId);

  const handleConfirm = () => {
    const tab = episodeTabs.find((t) => t.id === selectedId);
    if (!tab) return;
    onConfirm(tab.id, tab.title);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold text-gray-900">
          Quality Agent
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          Select the episode to evaluate. The previous episode will be used for
          hook context.
        </p>

        {episodeTabs.length === 0 ? (
          <p className="text-sm text-gray-400">
            No predefined episode tabs found in this document.
          </p>
        ) : (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          >
            {episodeTabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Evaluate
          </button>
        </div>
      </div>
    </div>
  );
}
