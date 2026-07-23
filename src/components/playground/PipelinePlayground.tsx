"use client";

import { useReducer, useCallback, useRef, useEffect, useMemo } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { taggedToTiptapJson } from "@/lib/ai/tagged-tiptap";
import { stripTagsForDisplay } from "@/components/ai/AIChatSidebar";
import { usePlaygroundAutosave } from "@/lib/ai/usePlaygroundAutosave";
import PlaygroundBlock from "./PlaygroundBlock";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlaygroundBlockData {
  content: string;        // Tiptap doc JSON string
  populatedAt?: string;   // ISO timestamp (world_state + beat_sequence)
  generatedAt?: string;   // ISO timestamp (story_logic)
}

interface PlaygroundData {
  blocks: {
    world_state: PlaygroundBlockData | null;
    beat_sequence: PlaygroundBlockData | null;
    story_logic: PlaygroundBlockData | null;
  };
}

type BlockKey = "world_state" | "beat_sequence" | "story_logic";

// ─── State ───────────────────────────────────────────────────────────────────

interface PlaygroundState {
  worldContent: string | null;
  beatsContent: string | null;
  storyContent: string | null;
  worldPopulatedAt: string | null;
  beatsPopulatedAt: string | null;
  storyGeneratedAt: string | null;
  saveStatus: "saved" | "saving" | "unsaved";
  isStreaming: boolean;
  streamingText: string;        // stripped for display
  streamingAccumulated: string; // raw for parsing
  // Confirm strips
  confirmRefreshWorld: boolean;
  confirmRefreshBeats: boolean;
  confirmConnectStory: boolean;
}

type Action =
  | { type: "SET_WORLD_CONTENT"; content: string }
  | { type: "SET_BEATS_CONTENT"; content: string }
  | { type: "SET_STORY_CONTENT"; content: string; generatedAt: string }
  | { type: "POPULATE"; worldContent: string | null; beatsContent: string | null; worldAt: string; beatsAt: string }
  | { type: "SET_SAVE_STATUS"; status: "saved" | "saving" | "unsaved" }
  | { type: "START_STREAMING" }
  | { type: "APPEND_STREAM"; raw: string }
  | { type: "END_STREAMING"; tiptapJson: string; generatedAt: string }
  | { type: "ABORT_STREAMING" }
  | { type: "SHOW_CONFIRM_REFRESH"; block: "world" | "beats" }
  | { type: "HIDE_CONFIRM_REFRESH"; block: "world" | "beats" }
  | { type: "SHOW_CONFIRM_CONNECT" }
  | { type: "HIDE_CONFIRM_CONNECT" }
  | { type: "REFRESH_WORLD"; content: string; at: string }
  | { type: "REFRESH_BEATS"; content: string; at: string };

function reducer(state: PlaygroundState, action: Action): PlaygroundState {
  switch (action.type) {
    case "SET_WORLD_CONTENT":
      return { ...state, worldContent: action.content };
    case "SET_BEATS_CONTENT":
      return { ...state, beatsContent: action.content };
    case "SET_STORY_CONTENT":
      return { ...state, storyContent: action.content, storyGeneratedAt: action.generatedAt };
    case "POPULATE":
      return {
        ...state,
        worldContent: action.worldContent,
        beatsContent: action.beatsContent,
        worldPopulatedAt: action.worldAt,
        beatsPopulatedAt: action.beatsAt,
      };
    case "SET_SAVE_STATUS":
      return { ...state, saveStatus: action.status };
    case "START_STREAMING":
      return { ...state, isStreaming: true, streamingText: "", streamingAccumulated: "", confirmConnectStory: false };
    case "APPEND_STREAM": {
      const raw = action.raw;
      const stripped = raw.replace(/^[012]\n/, "");
      return {
        ...state,
        streamingAccumulated: raw,
        streamingText: stripTagsForDisplay(stripped),
      };
    }
    case "END_STREAMING":
      return {
        ...state,
        isStreaming: false,
        streamingText: "",
        streamingAccumulated: "",
        storyContent: action.tiptapJson,
        storyGeneratedAt: action.generatedAt,
      };
    case "ABORT_STREAMING":
      return { ...state, isStreaming: false, streamingText: "", streamingAccumulated: "" };
    case "SHOW_CONFIRM_REFRESH":
      return action.block === "world"
        ? { ...state, confirmRefreshWorld: true }
        : { ...state, confirmRefreshBeats: true };
    case "HIDE_CONFIRM_REFRESH":
      return action.block === "world"
        ? { ...state, confirmRefreshWorld: false }
        : { ...state, confirmRefreshBeats: false };
    case "SHOW_CONFIRM_CONNECT":
      return { ...state, confirmConnectStory: true };
    case "HIDE_CONFIRM_CONNECT":
      return { ...state, confirmConnectStory: false };
    case "REFRESH_WORLD":
      return { ...state, worldContent: action.content, worldPopulatedAt: action.at, confirmRefreshWorld: false };
    case "REFRESH_BEATS":
      return { ...state, beatsContent: action.content, beatsPopulatedAt: action.at, confirmRefreshBeats: false };
    default:
      return state;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePlaygroundData(raw: string | null): PlaygroundData {
  if (!raw) return { blocks: { world_state: null, beat_sequence: null, story_logic: null } };
  try {
    const parsed = JSON.parse(raw) as PlaygroundData;
    if (parsed?.blocks) return parsed;
  } catch { /* fall through */ }
  return { blocks: { world_state: null, beat_sequence: null, story_logic: null } };
}

function tabContentToTiptapJson(tab: TabRow | undefined): string | null {
  if (!tab?.content) return null;
  // Skip if it's a stub ([H1] only)
  try {
    const doc = JSON.parse(tab.content) as { type: string; content?: unknown[] };
    const children = Array.isArray(doc.content) ? doc.content : [];
    if (
      children.length === 0 ||
      (children.length === 1 &&
        (children[0] as { type?: string; attrs?: { level?: number } }).type === "heading" &&
        (children[0] as { type?: string; attrs?: { level?: number } }).attrs?.level === 1)
    ) {
      return null;
    }
    return tab.content;
  } catch {
    return null;
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface PipelinePlaygroundProps {
  tab: TabRow;
  tabs: TabRow[];
  documentId: string;
  modelId: string;
  thinking: boolean;
  onTabsChange: (tabs: TabRow[]) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PipelinePlayground({
  tab,
  tabs,
  documentId,
  modelId,
  thinking,
  onTabsChange,
}: PipelinePlaygroundProps) {
  const data = useMemo(() => parsePlaygroundData(tab.content), [tab.content]);

  const [state, dispatch] = useReducer(reducer, {
    worldContent: data.blocks.world_state?.content ?? null,
    beatsContent: data.blocks.beat_sequence?.content ?? null,
    storyContent: data.blocks.story_logic?.content ?? null,
    worldPopulatedAt: data.blocks.world_state?.populatedAt ?? null,
    beatsPopulatedAt: data.blocks.beat_sequence?.populatedAt ?? null,
    storyGeneratedAt: data.blocks.story_logic?.generatedAt ?? null,
    saveStatus: "saved",
    isStreaming: false,
    streamingText: "",
    streamingAccumulated: "",
    confirmRefreshWorld: false,
    confirmRefreshBeats: false,
    confirmConnectStory: false,
  });

  // Canonical tab references
  const worldStateTab = tabs.find((t) => t.type === "world_state");
  const beatSeqTab = tabs.find((t) => t.type === "beat_sequence");
  const storyLogicTab = tabs.find((t) => t.type === "story_logic");

  // Auto-populate from canonical tabs on first mount when blocks are null
  useEffect(() => {
    if (data.blocks.world_state === null || data.blocks.beat_sequence === null) {
      const worldJson = tabContentToTiptapJson(worldStateTab);
      const beatsJson = tabContentToTiptapJson(beatSeqTab);
      const now = new Date().toISOString();
      dispatch({
        type: "POPULATE",
        worldContent: worldJson ?? state.worldContent,
        beatsContent: beatsJson ?? state.beatsContent,
        worldAt: now,
        beatsAt: now,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave — serialize current state into PlaygroundData JSON
  const stateRef = useRef(state);
  stateRef.current = state;

  const getContent = useCallback(() => {
    const s = stateRef.current;
    const now = new Date().toISOString();
    const pd: PlaygroundData = {
      blocks: {
        world_state: s.worldContent
          ? { content: s.worldContent, populatedAt: s.worldPopulatedAt ?? now }
          : null,
        beat_sequence: s.beatsContent
          ? { content: s.beatsContent, populatedAt: s.beatsPopulatedAt ?? now }
          : null,
        story_logic: s.storyContent
          ? { content: s.storyContent, populatedAt: now, generatedAt: s.storyGeneratedAt ?? now }
          : null,
      },
    };
    return JSON.stringify(pd);
  }, []);

  const onStatusChange = useCallback(
    (status: "saved" | "saving" | "unsaved") => dispatch({ type: "SET_SAVE_STATUS", status }),
    []
  );

  const { scheduleFlush, flush } = usePlaygroundAutosave({
    documentId,
    tabId: tab.id,
    getContent,
    onStatusChange,
  });

  // Handlers for block content changes
  const handleWorldChange = useCallback(
    (json: string) => { dispatch({ type: "SET_WORLD_CONTENT", content: json }); scheduleFlush(); },
    [scheduleFlush]
  );
  const handleBeatsChange = useCallback(
    (json: string) => { dispatch({ type: "SET_BEATS_CONTENT", content: json }); scheduleFlush(); },
    [scheduleFlush]
  );
  const handleStoryChange = useCallback(
    (json: string) => { dispatch({ type: "SET_STORY_CONTENT", content: json, generatedAt: state.storyGeneratedAt ?? new Date().toISOString() }); scheduleFlush(); },
    [scheduleFlush, state.storyGeneratedAt]
  );

  // ─── Promote ───────────────────────────────────────────────────────────────

  const promote = useCallback(
    async (blockKey: BlockKey, content: string | null, canonicalTab: TabRow | undefined) => {
      if (!content || !canonicalTab) return;
      await fetch(`/api/documents/${documentId}/tabs/${canonicalTab.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      // Refresh tabs in parent
      const res = await fetch(`/api/documents/${documentId}/tabs`);
      if (res.ok) {
        const updated = await res.json() as TabRow[];
        onTabsChange(updated);
      }
      void flush();
    },
    [documentId, onTabsChange, flush]
  );

  const handlePromoteWorld = useCallback(
    () => promote("world_state", state.worldContent, worldStateTab),
    [promote, state.worldContent, worldStateTab]
  );
  const handlePromoteBeats = useCallback(
    () => promote("beat_sequence", state.beatsContent, beatSeqTab),
    [promote, state.beatsContent, beatSeqTab]
  );
  const handlePromoteStory = useCallback(
    () => promote("story_logic", state.storyContent, storyLogicTab),
    [promote, state.storyContent, storyLogicTab]
  );

  // ─── Refresh ───────────────────────────────────────────────────────────────

  const handleRefreshClick = useCallback(() => {
    const canonicalWorldJson = tabContentToTiptapJson(worldStateTab);
    const canonicalBeatsJson = tabContentToTiptapJson(beatSeqTab);
    const now = new Date().toISOString();

    // Check if world block has been edited (differs from canonical)
    const worldEdited = state.worldContent && canonicalWorldJson && state.worldContent !== canonicalWorldJson;
    const beatsEdited = state.beatsContent && canonicalBeatsJson && state.beatsContent !== canonicalBeatsJson;

    if (worldEdited) {
      dispatch({ type: "SHOW_CONFIRM_REFRESH", block: "world" });
    } else if (canonicalWorldJson) {
      dispatch({ type: "REFRESH_WORLD", content: canonicalWorldJson, at: now });
      scheduleFlush();
    }

    if (beatsEdited) {
      dispatch({ type: "SHOW_CONFIRM_REFRESH", block: "beats" });
    } else if (canonicalBeatsJson) {
      dispatch({ type: "REFRESH_BEATS", content: canonicalBeatsJson, at: now });
      scheduleFlush();
    }
  }, [worldStateTab, beatSeqTab, state.worldContent, state.beatsContent, scheduleFlush]);

  // ─── Connect Story ─────────────────────────────────────────────────────────

  const handleConnectStoryClick = useCallback(() => {
    if (state.storyContent) {
      dispatch({ type: "SHOW_CONFIRM_CONNECT" });
    } else {
      void runConnectStory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.storyContent]);

  const runConnectStory = useCallback(async () => {
    if (!state.worldContent || !state.beatsContent) return;
    dispatch({ type: "START_STREAMING" });

    // Build context from playground blocks
    const worldTagged = tiptapJsonToTagged(state.worldContent);
    const beatsTagged = tiptapJsonToTagged(state.beatsContent);
    const contextStr = `=== World State ===\n${worldTagged}\n\n=== Beats ===\n${beatsTagged}`;
    const messages = [{ role: "user" as const, content: contextStr }];

    try {
      const res = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, mode: "pipe_causality", modelId, thinking }),
      });

      if (!res.ok) {
        dispatch({ type: "ABORT_STREAMING" });
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          dispatch({ type: "APPEND_STREAM", raw: accumulated });
        }
      }

      // On stream end: strip only the 0/1 prefix (keep structural tags for parsing)
      const clean = accumulated.replace(/^[012]\n/, "");
      const tiptapJson = taggedToTiptapJson(clean);
      dispatch({ type: "END_STREAMING", tiptapJson, generatedAt: new Date().toISOString() });
      scheduleFlush();
    } catch {
      dispatch({ type: "ABORT_STREAMING" });
    }
  }, [state.worldContent, state.beatsContent, modelId, thinking, scheduleFlush]);

  const worldEmpty = !state.worldContent;
  const beatsEmpty = !state.beatsContent;

  // ─── Render ────────────────────────────────────────────────────────────────

  const bothEmpty = worldEmpty && beatsEmpty;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 mb-4 border border-gray-200 rounded-lg bg-white">
          <span className="text-sm font-semibold text-gray-700">Playground</span>
          <div className="flex items-center gap-3">
            <span
              aria-live="polite"
              className="text-xs text-gray-500"
            >
              {state.saveStatus === "saving"
                ? "Saving…"
                : state.saveStatus === "unsaved"
                ? "Unsaved changes"
                : "Saved"}
            </span>
            <button
              aria-label="Refresh blocks from canonical tabs"
              onClick={handleRefreshClick}
              disabled={state.isStreaming}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded
                text-gray-400 hover:bg-gray-100 hover:text-gray-600 cursor-pointer
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Empty state when both source tabs are empty */}
        {bothEmpty ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
            <p className="text-sm text-gray-600">
              Run <b>Build World</b> and <b>Suggest Beats</b> from the sidebar first, then return here to curate and connect the story.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* World State block */}
            <div>
              {state.confirmRefreshWorld && (
                <div
                  role="alertdialog"
                  aria-label="Confirm refresh World State"
                  className="mb-2 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                >
                  <p className="flex-1 text-sm text-amber-800">
                    World State has unsaved edits. Refresh will overwrite them. Continue?
                  </p>
                  <button
                    autoFocus
                    onClick={() => {
                      const json = tabContentToTiptapJson(worldStateTab);
                      if (json) { dispatch({ type: "REFRESH_WORLD", content: json, at: new Date().toISOString() }); scheduleFlush(); }
                      else dispatch({ type: "HIDE_CONFIRM_REFRESH", block: "world" });
                    }}
                    onKeyDown={(e) => { if (e.key === "Escape") dispatch({ type: "HIDE_CONFIRM_REFRESH", block: "world" }); }}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors duration-200"
                  >
                    Continue
                  </button>
                  <button
                    onClick={() => dispatch({ type: "HIDE_CONFIRM_REFRESH", block: "world" })}
                    className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <PlaygroundBlock
                label="World State"
                content={state.worldContent}
                placeholder="World State will auto-populate from the World State tab when you open Playground."
                ariaLabel="Promote World State to its tab"
                onContentChange={handleWorldChange}
                onPromote={handlePromoteWorld}
                promoteDisabled={!state.worldContent}
              />
            </div>

            {/* Beats block */}
            <div>
              {state.confirmRefreshBeats && (
                <div
                  role="alertdialog"
                  aria-label="Confirm refresh Beats"
                  className="mb-2 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                >
                  <p className="flex-1 text-sm text-amber-800">
                    Beats has unsaved edits. Refresh will overwrite them. Continue?
                  </p>
                  <button
                    autoFocus
                    onClick={() => {
                      const json = tabContentToTiptapJson(beatSeqTab);
                      if (json) { dispatch({ type: "REFRESH_BEATS", content: json, at: new Date().toISOString() }); scheduleFlush(); }
                      else dispatch({ type: "HIDE_CONFIRM_REFRESH", block: "beats" });
                    }}
                    onKeyDown={(e) => { if (e.key === "Escape") dispatch({ type: "HIDE_CONFIRM_REFRESH", block: "beats" }); }}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors duration-200"
                  >
                    Continue
                  </button>
                  <button
                    onClick={() => dispatch({ type: "HIDE_CONFIRM_REFRESH", block: "beats" })}
                    className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <PlaygroundBlock
                label="Beats"
                content={state.beatsContent}
                placeholder="Beats will auto-populate from the Beats tab when you open Playground."
                ariaLabel="Promote Beats to its tab"
                onContentChange={handleBeatsChange}
                onPromote={handlePromoteBeats}
                promoteDisabled={!state.beatsContent}
              />
            </div>

            {/* Connect Story button */}
            <div className="my-4">
              {state.confirmConnectStory && (
                <div
                  role="alertdialog"
                  aria-label="Confirm re-run Connect Story"
                  className="mb-2 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                >
                  <p className="flex-1 text-sm text-amber-800">
                    Running Connect Story will replace the existing Story Logic. Continue?
                  </p>
                  <button
                    autoFocus
                    onClick={() => void runConnectStory()}
                    onKeyDown={(e) => { if (e.key === "Escape") dispatch({ type: "HIDE_CONFIRM_CONNECT" }); }}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors duration-200"
                  >
                    Continue
                  </button>
                  <button
                    onClick={() => dispatch({ type: "HIDE_CONFIRM_CONNECT" })}
                    className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <button
                disabled={worldEmpty || beatsEmpty || state.isStreaming}
                onClick={handleConnectStoryClick}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white
                  hover:bg-indigo-700 transition-colors duration-200 min-h-[44px]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {state.isStreaming ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Connecting…
                  </span>
                ) : (
                  "Connect Story"
                )}
              </button>
            </div>

            {/* Story Logic block — only shown once Connect Story has run */}
            {(state.storyContent || state.isStreaming) && (
              <PlaygroundBlock
                label="Story Logic"
                content={state.storyContent}
                placeholder="Run Connect Story to generate the causal narrative from your World State and Beats."
                ariaLabel="Promote Story Logic to its tab"
                isStreaming={state.isStreaming}
                streamingText={state.streamingText}
                onContentChange={handleStoryChange}
                onPromote={handlePromoteStory}
                promoteDisabled={state.isStreaming || !state.storyContent}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
