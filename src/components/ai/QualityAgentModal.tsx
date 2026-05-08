"use client";

import { useState, useMemo } from "react";
import type { TabRow } from "@/components/editor/TabRail";

interface Episode {
  index: number;       // 0-based position among all episodes in the tab
  title: string;       // e.g. "Episode 3: Fabrication"
}

function extractEpisodes(content: string | null): Episode[] {
  if (!content) return [];
  try {
    const doc = JSON.parse(content) as { content?: { type: string; attrs?: { level?: number }; content?: { text?: string }[] }[] };
    const nodes = doc.content ?? [];
    const episodes: Episode[] = [];
    let idx = 0;
    for (const node of nodes) {
      if (node.type === "heading") {
        const text = node.content?.map((c) => c.text ?? "").join("") ?? "";
        // Match any heading that looks like an episode (H1, H2, H3 starting with "Episode")
        if (/^episode\s*\d/i.test(text.trim())) {
          episodes.push({ index: idx, title: text.trim() });
          idx++;
        }
      }
    }
    return episodes;
  } catch {
    return [];
  }
}

interface QualityAgentModalProps {
  tabs: TabRow[];
  currentTabId: string;
  onConfirm: (tabId: string, episodeTitle: string, episodeIndex: number) => void;
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

  // Use the current tab if it's a predefined_episodes tab, else the first one
  const defaultTab =
    episodeTabs.find((t) => t.id === currentTabId) ?? episodeTabs[0];

  const [selectedTabId, setSelectedTabId] = useState(defaultTab?.id ?? "");

  const selectedTab = episodeTabs.find((t) => t.id === selectedTabId);
  const episodes = useMemo(
    () => extractEpisodes(selectedTab?.content ?? null),
    [selectedTab]
  );

  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState(
    episodes.length > 0 ? episodes[episodes.length - 1].index : 0
  );

  // When episodes load (tab changes), default to the last episode
  const episodeOptions = episodes.length > 0 ? episodes : null;

  const handleConfirm = () => {
    if (!selectedTab) return;
    if (episodeOptions) {
      const ep =
        episodeOptions.find((e) => e.index === selectedEpisodeIndex) ??
        episodeOptions[episodeOptions.length - 1];
      onConfirm(selectedTab.id, ep.title, ep.index);
    } else {
      onConfirm(selectedTab.id, selectedTab.title, 0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold text-gray-900">
          Quality Agent
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          Select the episode to evaluate. Previous episodes and series summary
          will be used for context.
        </p>

        {episodeTabs.length === 0 ? (
          <p className="text-sm text-gray-400">
            No predefined episode tabs found in this document.
          </p>
        ) : (
          <div className="space-y-3">
            {episodeTabs.length > 1 && (
              <select
                value={selectedTabId}
                onChange={(e) => setSelectedTabId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              >
                {episodeTabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}

            {episodeOptions ? (
              <select
                value={selectedEpisodeIndex}
                onChange={(e) =>
                  setSelectedEpisodeIndex(Number(e.target.value))
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              >
                {episodeOptions.map((ep) => (
                  <option key={ep.index} value={ep.index}>
                    {ep.title}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-gray-400">
                No episode headings found — will evaluate the full tab.
              </p>
            )}
          </div>
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
            disabled={!selectedTab}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            Evaluate
          </button>
        </div>
      </div>
    </div>
  );
}
