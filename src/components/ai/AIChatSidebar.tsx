"use client";

import { useState, useRef, useEffect, useCallback, useMemo, RefObject } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import type { EditorHandle } from "@/components/editor/Editor";
import { buildAIContext, buildPipelineStepContext, buildPlotLabContext, tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { parseCharacterProfiles, normalizeCharacterName } from "@/lib/ai/characters";
import type { useJob, JobKind } from "@/lib/ai/useJob";
import { handleTextareaLineMoveKeyDown } from "@/lib/editing/line-move";
import { taggedTextToTiptapDoc } from "@/lib/editor/tagged-parser";
import { inferPlotLabDecisionSection } from "@/lib/plot-lab/workflow";

type AIJobController = ReturnType<typeof useJob>;

const JOB_LABELS: Partial<Record<JobKind, string>> = {
  next_reference_episode: "Create Pre-defined Episode",
};

// ─── Types ───

type Mode =
  | "edit" | "draft" | "feedback" | "format" | "chat"
  | "pipe_world_state" | "pipe_beat_gen" | "pipe_causality" | "pipe_plot_synth"
  | "pipe_continuation_state" | "pipe_continuation_beats" | "pipe_continuation_logic" | "pipe_continuation_synth"
  | "plot_lab_chat" | "plot_lab_save_preview" | "plot_lab_final_plot";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type HistoryEntry =
  | { type: "mode-change"; id?: string; mode: Mode; timestamp: number }
  | { type: "message"; id?: string; role: "user" | "assistant"; content: string; mode: Mode };

const MODE_LABELS: Record<Mode, string> = {
  edit: "Edit Selection",
  draft: "Story Creation",
  feedback: "Document Feedback",
  format: "Format Document",
  chat: "Chat",
  pipe_world_state: "Build World",
  pipe_beat_gen: "Suggest Beats",
  pipe_causality: "Connect the Story",
  pipe_plot_synth: "Write Plots",
  pipe_continuation_state: "Build Continuation State",
  pipe_continuation_beats: "Suggest Continuation Beats",
  pipe_continuation_logic: "Connect Continuation Story",
  pipe_continuation_synth: "Write Continuation Pack",
  plot_lab_chat: "Plot Lab",
  plot_lab_save_preview: "Plot Lab Save Preview",
  plot_lab_final_plot: "Plot Lab Final Plot",
};

// Strip structural tags ([H1] [P] [UL] etc.) and [CHANGE] scaffolding for
// display. Writers see just the prose — they copy anything actionable by hand.
export function stripTagsForDisplay(text: string): string {
  const changeBlocks = text.split(/\[CHANGE \d+\]/i);
  let working = text;
  if (changeBlocks.length > 1) {
    working = changeBlocks
      .slice(1)
      .map((block) => block.match(/Suggested:\s*([\s\S]*?)$/i)?.[1]?.trim() ?? "")
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
  return working
    .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")
    .split("\n")
    .map((l) => l.replace(/^\[(?:H\d|OL|UL|P|HR)\]\s*/, ""))
    .filter((l) => l.trim())
    .join("\n");
}

function assistantEmptyState(tabType: string, plotLabActive: boolean): string {
  if (plotLabActive) {
    return "Ask Levi to scan Plot 1 and Predefined Episode 1, then confirm the next story decision one question at a time.";
  }
  if (tabType === "microdrama_plots") {
    return "Ask for plot help, or use the four-step pipeline above. Pipeline results stay in chat for you to copy.";
  }
  if (tabType === "predefined_episodes") {
    return "Ask for episode help here, or open Predefined Lab for the structured workflow.";
  }
  if (tabType === "characters") {
    return "Ask for character help, or add a character heading above.";
  }
  return "Ask the Assistant for help with this document.";
}

// ─── Props ───

type PipelineBranch = "monetization" | "regular";
type PlotLabSaveKind = "decision_lock" | "character_lock" | "location_lock" | "beat_shortlist" | "episode_sketch_lock" | "final_plot_commit";

const PLOT_LAB_SAVE_LABELS: Record<PlotLabSaveKind, string> = {
  decision_lock: "Plot Lab decision",
  character_lock: "Character decision",
  location_lock: "Location decision",
  beat_shortlist: "Selected beat",
  episode_sketch_lock: "Episode sketch",
  final_plot_commit: "Final plot",
};

const PLOT_LAB_DESTINATION_LABELS: Record<PlotLabSaveKind, string> = {
  decision_lock: "Plot Lab Decisions",
  character_lock: "Characters",
  location_lock: "Locations",
  beat_shortlist: "Beats",
  episode_sketch_lock: "Episode Sketches",
  final_plot_commit: "Microdrama Plots",
};

function targetTabTypeForPlotLabSave(kind: PlotLabSaveKind): string {
  if (kind === "decision_lock") return "plot_lab_decisions";
  if (kind === "character_lock") return "characters";
  if (kind === "location_lock") return "locations";
  if (kind === "beat_shortlist") return "beat_sequence";
  if (kind === "final_plot_commit") return "microdrama_plots";
  return "episode_sketches";
}

function stripAssistantTextForSave(content: string): string {
  const display = stripTagsForDisplay(content);
  const textToSave = display.match(/^Text to save:\s*(.+)$/im)?.[1]?.trim();
  if (textToSave) return textToSave;
  return display
    .replace(/^Save Preview\s*/i, "")
    .replace(/^(?:Save kind|Destination tab|Why it matters):.*$/gim, "")
    .replace(/^Text to save:\s*/gim, "")
    .trim();
}

function inferPlotLabSaveKind(content: string): PlotLabSaveKind {
  const display = stripTagsForDisplay(content);
  const destination = display.match(/^Destination tab:\s*(.+)$/im)?.[1]?.trim().toLowerCase() ?? "";
  const saveKind = display.match(/^Save kind:\s*(.+)$/im)?.[1]?.trim().toLowerCase() ?? "";
  const combined = `${destination} ${saveKind}`;
  if (combined.includes("plot lab") || combined.includes("decision ledger") || combined.includes("runway decision") || combined.includes("soul") || combined.includes("paywall") || combined.includes("core contract")) return "decision_lock";
  if (combined.includes("microdrama") || combined.includes("final plot")) return "final_plot_commit";
  if (combined.includes("episode sketch")) return "episode_sketch_lock";
  if (combined.includes("beat")) return "beat_shortlist";
  if (combined.includes("location")) return "location_lock";
  if (combined.includes("character")) return "character_lock";
  return "decision_lock";
}

function taggedParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((block) => `[P] ${block}`)
    .join("\n");
}

function buildPlotLabTaggedSave(kind: PlotLabSaveKind, text: string, episodeNumber: string): string {
  const body = taggedParagraphs(text);
  const episode = episodeNumber.trim();
  const timestamp = new Date().toISOString().slice(0, 10);
  if (kind === "episode_sketch_lock") {
    const title = episode ? `Episode ${episode} Sketch` : `Episode Sketch ${timestamp}`;
    return `[H3] ${title}\n${body}`;
  }
  if (kind === "final_plot_commit") {
    if (/^\[H3\]/m.test(text)) return text.trim();
    const title = episode ? `Episode ${episode}: Plot` : `Episode Plot ${timestamp}`;
    return `[H3] ${title}\n${body}`;
  }
  if (kind === "beat_shortlist") return `[H2] Selected Beats ${timestamp}\n${body}`;
  if (kind === "location_lock") return `[H2] Location Decisions ${timestamp}\n${body}`;
  if (kind === "decision_lock") {
    const section = inferPlotLabDecisionSection(text);
    return `[H2] ${section}\n${body}`;
  }
  return `[H2] Character Decisions ${timestamp}\n${body}`;
}

interface PlotLabChoice {
  key: string;
  label: string;
  detail: string;
  response: string;
  compact?: boolean;
}

function cleanPlotLabChoiceText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

function plotLabChoiceLineMatch(line: string): RegExpMatchArray | null {
  return line.match(/^\s*[-•]?\s*(?:\*\*)?((?:[A-D]\d*)|(?:Option\s+\d+)|(?:\d+))\)\s*(.*)$/i);
}

function latestPlotLabChoiceWindow(lines: string[]): { start: number; end: number } | null {
  const choiceIndexes = lines
    .map((line, index) => (plotLabChoiceLineMatch(line) ? index : -1))
    .filter((index) => index >= 0);
  if (choiceIndexes.length === 0) return null;

  let start = choiceIndexes[choiceIndexes.length - 1];
  const lastChoice = start;
  for (let index = choiceIndexes.length - 2; index >= 0; index -= 1) {
    const previous = choiceIndexes[index];
    const between = lines.slice(previous + 1, start).join("\n").trim();
    if (between.length > 0) break;
    start = previous;
  }
  let end = lastChoice + 1;
  while (end < lines.length && lines[end].trim().length === 0) end += 1;
  return { start, end };
}

function parsePlotLabChoices(text: string): { prompt: string; choices: PlotLabChoice[]; after: string } | null {
  const lines = text.split("\n");
  const window = latestPlotLabChoiceWindow(lines);
  if (!window) return null;

  const optionLines = lines.slice(window.start, window.end);
  const choices: PlotLabChoice[] = [];

  for (const line of optionLines) {
    const match = plotLabChoiceLineMatch(line);
    if (!match) continue;
    const key = match[1].replace(/\s+/g, " ").trim().toUpperCase();
    const rest = match[2].trim();
    const titleMatch = rest.match(/^(.*?)(?:\*\*)?\s*:\s*(.*)$/);
    const label = cleanPlotLabChoiceText(titleMatch?.[1] ?? rest);
    const detail = cleanPlotLabChoiceText(titleMatch?.[2] ?? "");
    if (!label || !detail) continue;
    const response = detail ? `I choose ${key}: ${label}. ${detail}` : `I choose ${key}: ${label}`;
    choices.push({ key, label, detail, response });
  }

  if (choices.length < 2) return null;
  return {
    prompt: lines.slice(0, window.start).join("\n").trim(),
    choices: choices.slice(-4),
    after: lines.slice(window.end).join("\n").trim(),
  };
}

function uniquePlotLabChoices(choices: PlotLabChoice[]): PlotLabChoice[] {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = choice.key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseInlinePlotLabQuickChoices(text: string): PlotLabChoice[] {
  const choices: PlotLabChoice[] = [];
  const replyMatch = text.match(/\b(?:reply|choose|pick|select)\s+(?:with\s+)?([A-D]\d?(?:\s*,\s*[A-D]\d?)*(?:\s*,?\s*or\s+[A-D]\d?)?)/i);
  if (replyMatch) {
    for (const token of replyMatch[1].match(/[A-D]\d?/gi) ?? []) {
      const key = token.toUpperCase();
      choices.push({ key, label: key, detail: "", response: `I choose ${key}.`, compact: true });
    }
  }

  if (/\byes\s*\/\s*no\b/i.test(text) || /\bconfirm\b/i.test(text)) {
    choices.push(
      { key: "yes", label: "Yes, confirm", detail: "", response: "Yes, confirm this.", compact: true },
      { key: "tweak", label: "Tweak", detail: "", response: "I want to tweak this before confirming.", compact: true },
      { key: "no", label: "No", detail: "", response: "No, this is not right.", compact: true }
    );
  }

  if (/\breroll\b|\bnew options\b|\btry again\b/i.test(text)) {
    choices.push({ key: "reroll", label: "Reroll", detail: "", response: "Reroll these options with a different angle.", compact: true });
  }

  if (choices.length === 0 && /\?$/.test(text.trim())) {
    choices.push(
      { key: "agree", label: "Looks right", detail: "", response: "This looks right. Continue.", compact: true },
      { key: "custom", label: "I will type", detail: "", response: "", compact: true }
    );
  }

  return uniquePlotLabChoices(choices).filter((choice) => choice.response || choice.key === "custom");
}

function normalizeAssistantDisplayContent(content: string): string {
  if (content.startsWith("[CLARIFY]")) {
    return content.replace(/^\[CLARIFY\]\s*/, "");
  }
  if (/^\[(?:H\d|OL|UL|P)]/m.test(content) || content.includes("[CHANGE")) {
    return stripTagsForDisplay(content);
  }
  return content;
}

function hasPlotLabActions(content: string): boolean {
  const displayContent = normalizeAssistantDisplayContent(content);
  return Boolean(parsePlotLabChoices(displayContent)) || parseInlinePlotLabQuickChoices(displayContent).length > 0;
}

function isPlotLabMode(mode: Mode): boolean {
  return mode === "plot_lab_chat" || mode === "plot_lab_save_preview" || mode === "plot_lab_final_plot";
}

function isPlotLabStageSummary(content: string): boolean {
  const displayContent = normalizeAssistantDisplayContent(content);
  return /stage summary/i.test(displayContent)
    && /what was decided/i.test(displayContent)
    && /what this unlocks/i.test(displayContent)
    && /destination tab/i.test(displayContent)
    && /-\s*A\)\s*Confirm/i.test(displayContent);
}

function isPlotLabConfirmDecision(decisionText: string): boolean {
  return /\b(?:yes,\s*)?confirm\b|\blooks right\b|\bthis looks right\b|\bsave this\b/i.test(decisionText);
}

interface AIChatSidebarProps {
  documentId: string;
  tabs: TabRow[];
  activeTab: TabRow;
  editorRef: RefObject<EditorHandle | null>;
  editorIsEmpty: boolean;
  modelId: string;
  thinking: boolean;
  isAdmin: boolean;
  pipelineBranch: PipelineBranch;
  plotLabActive: boolean;
  canUsePlotLab: boolean;
  aiJob: AIJobController;
  onFlushPendingSave: () => Promise<void>;
  onAIJobApplied: (landedTabId: string) => Promise<void>;
  onSetModel: (modelId: string) => void;
  onSetThinking: (enabled: boolean) => void;
  onSetTitle: (title: string) => void;
  onPlotLabActiveChange: (active: boolean) => void;
  onOpenPredefinedLab: () => Promise<void>;
  onClose: () => void;
}

export default function AIChatSidebar({
  documentId,
  tabs,
  activeTab,
  editorRef,
  modelId,
  thinking,
  isAdmin,
  pipelineBranch,
  plotLabActive,
  canUsePlotLab,
  aiJob,
  onFlushPendingSave,
  onAIJobApplied,
  onSetModel,
  onSetThinking,
  onPlotLabActiveChange,
  onOpenPredefinedLab,
  onClose,
}: AIChatSidebarProps) {
  type PipelineStepId =
    | "pipe_world_state"
    | "pipe_beat_gen"
    | "pipe_causality"
    | "pipe_plot_synth"
    | "pipe_continuation_state"
    | "pipe_continuation_beats"
    | "pipe_continuation_logic"
    | "pipe_continuation_synth";

  type PipelineGroup = "Monetization Runway" | "Beyond Monetization";

  const PIPELINE_STEPS = useMemo<{
    id: PipelineStepId;
    label: string;
    group: PipelineGroup;
    enabledWhenTabType: string;
    requiredTabLabel: string;
  }[]>(() => [
    { id: "pipe_world_state", label: "Build World", group: "Monetization Runway", enabledWhenTabType: "series_overview", requiredTabLabel: "Series Overview" },
    { id: "pipe_beat_gen", label: "Suggest Beats", group: "Monetization Runway", enabledWhenTabType: "world_state", requiredTabLabel: "World State" },
    { id: "pipe_causality", label: "Connect the Story", group: "Monetization Runway", enabledWhenTabType: "beat_sequence", requiredTabLabel: "Beats" },
    { id: "pipe_plot_synth", label: "Write Plots", group: "Monetization Runway", enabledWhenTabType: "story_logic", requiredTabLabel: "Story Logic" },
    { id: "pipe_continuation_state", label: "Build Continuation State", group: "Beyond Monetization", enabledWhenTabType: "microdrama_plots", requiredTabLabel: "Microdrama Plots" },
    { id: "pipe_continuation_beats", label: "Suggest Continuation Beats", group: "Beyond Monetization", enabledWhenTabType: "world_state", requiredTabLabel: "World State" },
    { id: "pipe_continuation_logic", label: "Connect Continuation Story", group: "Beyond Monetization", enabledWhenTabType: "beat_sequence", requiredTabLabel: "Beats" },
    { id: "pipe_continuation_synth", label: "Write Continuation Pack", group: "Beyond Monetization", enabledWhenTabType: "story_logic", requiredTabLabel: "Story Logic" },
  ], []);
  const [activeStep, setActiveStep] = useState<PipelineStepId | null>(null);
  const selectedPipelineGroup: PipelineGroup = isAdmin && pipelineBranch === "regular" ? "Beyond Monetization" : "Monetization Runway";
  const mode: Mode = plotLabActive ? "plot_lab_chat" : activeStep ?? "chat";
  const getStepLabel = useCallback((step: { id: PipelineStepId; label: string }) => {
    if (isAdmin && step.id === "pipe_plot_synth") return "Write Monetization Plot";
    return step.label;
  }, [isAdmin]);
  const getModeLabel = useCallback((entryMode: Mode) => {
    if (isAdmin && entryMode === "pipe_plot_synth") return "Write Monetization Plot";
    return MODE_LABELS[entryMode];
  }, [isAdmin]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOpeningPredefinedLab, setIsOpeningPredefinedLab] = useState(false);
  const [isApplyingJob, setIsApplyingJob] = useState(false);
  const [plotLabSaveOpen, setPlotLabSaveOpen] = useState(false);
  const [plotLabSaveText, setPlotLabSaveText] = useState("");
  const [plotLabSaveKind, setPlotLabSaveKind] = useState<PlotLabSaveKind>("episode_sketch_lock");
  const [plotLabEpisodeNumber, setPlotLabEpisodeNumber] = useState("");
  const [isPlotLabSaving, setIsPlotLabSaving] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    try { return localStorage.getItem("ai-send-on-enter") === "true"; } catch { return false; }
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputPanelHeightRef = useRef(160);
  const [inputPanelHeight, setInputPanelHeight] = useState(160);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inputPanelHeightRef.current;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const containerH = containerRef.current?.getBoundingClientRect().height ?? 600;
      const next = Math.min(containerH * 0.5, Math.max(120, startH + delta));
      inputPanelHeightRef.current = next;
      setInputPanelHeight(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const isAIBusy = aiJob.state.status === "starting" || aiJob.state.status === "running";
  const latestActionableHistoryIndex = useMemo(() => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const entry = history[index];
      if (entry.type === "mode-change") continue;
      if (entry.role === "user") return -1;
      if (entry.mode === "plot_lab_chat" && hasPlotLabActions(entry.content)) return index;
      if (entry.mode === "plot_lab_save_preview") return index;
      return -1;
    }
    return -1;
  }, [history]);

  const persistedJobIdRef = useRef<string | null>(null);
  const lastJobEntryIdsRef = useRef<{ jobId: string; userId: string | null; assistantId: string | null } | null>(null);
  const clientApplyIdRef = useRef<string | null>(null);

  const handleAddCharacterHeading = useCallback(async () => {
    if (activeTab.type !== "characters") {
      setError("Open the Characters tab before adding a character.");
      return;
    }
    const rawName = window.prompt("Character name");
    const name = rawName?.replace(/\s+/g, " ").trim();
    if (!name) return;

    const liveTagged = tiptapJsonToTagged(editorRef.current?.getContentJSON() ?? null);
    const existing = parseCharacterProfiles(liveTagged);
    const key = normalizeCharacterName(name);
    const existingProfile = existing.find((profile) => profile.key === key);
    if (existingProfile) {
      setNotice(`${name} is already in Characters.`);
      setError(null);
      return;
    }

    const base = liveTagged.trim() || "[H1] Characters";
    const updated = `${base}\n\n[H2] ${name}`;
    editorRef.current?.setFullContent(updated);
    setNotice(`${name} added to Characters.`);
    setError(null);
    await onFlushPendingSave();
  }, [activeTab.type, editorRef, onFlushPendingSave]);

  const handleOpenPredefinedLab = useCallback(async () => {
    if (isOpeningPredefinedLab) return;
    setIsOpeningPredefinedLab(true);
    setError(null);
    try {
      await onOpenPredefinedLab();
    } catch {
      setError("Could not open Predefined Lab. Try again.");
      setIsOpeningPredefinedLab(false);
    }
  }, [isOpeningPredefinedLab, onOpenPredefinedLab]);

  useEffect(() => {
    if (activeTab.type !== "microdrama_plots" && activeStep && !isStreaming) {
      setActiveStep(null);
    }
  }, [activeStep, activeTab.type, isStreaming]);

  const handleApplyJob = useCallback(async () => {
    if (aiJob.state.status !== "completed" || !aiJob.state.output) return;
    if (!aiJob.state.kind || !aiJob.state.originTabId) return;
    if (!aiJob.state.jobId || isApplyingJob) return;

    setIsApplyingJob(true);
    setError(null);
    try {
      await onFlushPendingSave();
      const clientApplyId =
        clientApplyIdRef.current ??
        (clientApplyIdRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      const res = await fetch(`/api/ai/jobs/${aiJob.state.jobId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientApplyId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        reason?: string;
        landedTabId?: string;
        fellBack?: boolean;
      };
      if (!res.ok || !data.ok || !data.landedTabId) {
        setError(data.error ?? `Apply failed (${data.reason ?? res.status}).`);
        return;
      }
      await onAIJobApplied(data.landedTabId);
      if (data.fellBack) setError("Original tab missing; output landed in Workbook instead.");
      clientApplyIdRef.current = null;
      aiJob.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setIsApplyingJob(false);
    }
  }, [aiJob, isApplyingJob, onAIJobApplied, onFlushPendingSave]);

  const handleDiscardJob = useCallback(() => {
    clientApplyIdRef.current = null;
    const tracked = lastJobEntryIdsRef.current;
    if (tracked && tracked.jobId === aiJob.state.jobId) {
      const { userId, assistantId } = tracked;
      setHistory((prev) => prev.filter((e) => {
        if (e.type !== "message" || !e.id) return true;
        return e.id !== userId && e.id !== assistantId;
      }));
      if (userId) fetch(`/api/ai/chat-history?id=${userId}`, { method: "DELETE" }).catch(() => {});
      if (assistantId) fetch(`/api/ai/chat-history?id=${assistantId}`, { method: "DELETE" }).catch(() => {});
      lastJobEntryIdsRef.current = null;
    }
    aiJob.reset();
  }, [aiJob]);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setMessages([]);
    setStreamingText("");
    setError(null);
    setInput("");
    setNotice(null);
    setActiveStep(null);
    fetch(`/api/ai/chat-history?documentId=${documentId}`, { method: "DELETE" }).catch(() => {});
  }, [documentId]);

  const persistEntry = useCallback(
    async (entry: HistoryEntry): Promise<string | null> => {
      try {
        const res = await fetch("/api/ai/chat-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId,
            entryType: entry.type === "mode-change" ? "mode-change" : "message",
            role: entry.type === "message" ? entry.role : null,
            content: entry.type === "message" ? entry.content : null,
            mode: entry.mode,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { id?: string };
        return data.id ?? null;
      } catch {
        return null;
      }
    },
    [documentId]
  );

  // Persist completed job output to chat history once per jobId
  useEffect(() => {
    if (aiJob.state.status !== "completed") return;
    if (!aiJob.state.jobId || !aiJob.state.kind || !aiJob.state.output) return;
    if (persistedJobIdRef.current === aiJob.state.jobId) return;
    persistedJobIdRef.current = aiJob.state.jobId;
    const jobId = aiJob.state.jobId;
    const label = JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind;
    const userEntry: HistoryEntry = { type: "message", role: "user", content: label, mode: "chat" };
    const assistantEntry: HistoryEntry = { type: "message", role: "assistant", content: aiJob.state.output, mode: "chat" };
    (async () => {
      const userId = await persistEntry(userEntry);
      const assistantId = await persistEntry(assistantEntry);
      lastJobEntryIdsRef.current = { jobId, userId, assistantId };
      setHistory((prev) => [
        ...prev,
        { ...userEntry, id: userId ?? undefined },
        { ...assistantEntry, id: assistantId ?? undefined },
      ]);
    })();
  }, [aiJob.state.status, aiJob.state.jobId, aiJob.state.kind, aiJob.state.output, persistEntry]);

  // Load history on mount
  useEffect(() => {
    fetch(`/api/ai/chat-history?documentId=${documentId}`)
      .then((r) => r.json())
      .then((entries: { id: string; entryType: string; role: string | null; content: string | null; mode: string; createdAt: string }[]) => {
        if (!Array.isArray(entries)) return;
        const loaded: HistoryEntry[] = entries.map((e) =>
          e.entryType === "mode-change"
            ? { type: "mode-change" as const, id: e.id, mode: e.mode as Mode, timestamp: new Date(e.createdAt).getTime() }
            : { type: "message" as const, id: e.id, role: e.role as "user" | "assistant", content: e.content || "", mode: e.mode as Mode }
        );
        setHistory(loaded);
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [documentId]);

  useEffect(() => {
    if (historyLoaded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [historyLoaded]);

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming, streamingText]);

  const sendMessages = useCallback(
    async (
      msgs: ChatMessage[],
      opts: { selectionAtSubmit: boolean; originTabId: string; modeOverride?: Mode }
    ) => {
      const { modeOverride } = opts;
      const effectiveMode: Mode = modeOverride ?? mode;

      console.debug("[pipeline:send]", { effectiveMode, override: modeOverride ?? null });

      setIsStreaming(true);
      setStreamingText("");
      setError(null);

      try {
        const res = await fetch("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: msgs, mode: effectiveMode, modelId, thinking, documentId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "AI request failed");
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            accumulated += chunk;
            setStreamingText(accumulated.replace(/^[012]\n/, ""));
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = { role: "assistant", content: accumulated };
              }
              return updated;
            });
          }
        }

        const cleanAccumulated = accumulated.replace(/^[012]\n/, "");
        if (cleanAccumulated) {
          const assistantEntry: HistoryEntry = {
            type: "message",
            role: "assistant",
            content: cleanAccumulated,
            mode: effectiveMode,
          };
          setHistory((prev) => [...prev, assistantEntry]);
          persistEntry(assistantEntry);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [documentId, mode, modelId, thinking, persistEntry]
  );

  const buildUserMessage = useCallback((userInput: string): string => {
    const liveContent = editorRef.current?.getContentJSON() ?? null;
    if (plotLabActive) {
      const contextBlock = buildPlotLabContext({
        tabs,
        activeTab,
        activeTabLiveContent: liveContent,
        userMessage: userInput,
      });
      return `${contextBlock}\n\n## Message\n${userInput}`;
    }
    const contextBlock = buildAIContext({
      tabs,
      activeTab,
      activeTabLiveContent: liveContent,
      mode: "chat",
      selection: null,
      userMessage: userInput,
    });
    return `${contextBlock}\n\n## Message\n${userInput}`;
  }, [activeTab, editorRef, plotLabActive, tabs]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;

    const originTabId = activeTab.id;
    const userContent = buildUserMessage(input);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const newMessages = [...messages, userMsg, assistantMsg];

    setMessages(newMessages);
    setInput("");

    const userEntry: HistoryEntry = { type: "message", role: "user", content: input, mode };
    setHistory((prev) => [...prev, userEntry]);
    persistEntry(userEntry);

    sendMessages(newMessages.filter((m) => m.content), {
      selectionAtSubmit: false,
      originTabId,
    });
  }, [input, isStreaming, messages, sendMessages, mode, activeTab, persistEntry, buildUserMessage]);

  const handlePlotLabDecision = useCallback((decisionText: string, sourceAssistantText?: string) => {
    if (!plotLabActive || !decisionText.trim() || isStreaming) return;

    const originTabId = activeTab.id;
    const shouldPrepareSave =
      sourceAssistantText &&
      isPlotLabConfirmDecision(decisionText) &&
      isPlotLabStageSummary(sourceAssistantText);
    const nextMode: Mode = shouldPrepareSave ? "plot_lab_save_preview" : mode;
    const nextInput = shouldPrepareSave
      ? [
          "Prepare this confirmed Plot Lab stage summary for the system-of-record save preview.",
          "",
          "## Confirmed writer choice",
          decisionText,
          "",
          "## Levi stage summary",
          normalizeAssistantDisplayContent(sourceAssistantText),
        ].join("\n")
      : decisionText;
    const userContent = buildUserMessage(nextInput);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const newMessages = [...messages, userMsg, assistantMsg];

    setMessages(newMessages);
    setInput("");

    const userEntry: HistoryEntry = { type: "message", role: "user", content: decisionText, mode: nextMode };
    setHistory((prev) => [...prev, userEntry]);
    persistEntry(userEntry);

    sendMessages(newMessages.filter((m) => m.content), {
      selectionAtSubmit: false,
      originTabId,
      modeOverride: nextMode,
    });
  }, [activeTab.id, buildUserMessage, isStreaming, messages, mode, persistEntry, plotLabActive, sendMessages]);

  const openPlotLabSave = useCallback((content: string) => {
    setPlotLabSaveText(stripAssistantTextForSave(content));
    setPlotLabSaveKind(inferPlotLabSaveKind(content));
    const episodeMatch = content.match(/episode\s+(\d+)/i);
    setPlotLabEpisodeNumber(episodeMatch?.[1] ?? "");
    setPlotLabSaveOpen(true);
    setError(null);
  }, []);

  const confirmPlotLabSave = useCallback(async () => {
    const text = plotLabSaveText.trim();
    if (!text || isPlotLabSaving) return;
    const targetType = targetTabTypeForPlotLabSave(plotLabSaveKind);
    const target = tabs.find((tab) => tab.type === targetType);
    if (!target) {
      setError(`Could not find the ${PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]} tab.`);
      return;
    }

    setIsPlotLabSaving(true);
    setError(null);
    try {
      await onFlushPendingSave();
      const targetLiveContent =
        target.id === activeTab.id
          ? editorRef.current?.getContentJSON?.() ?? target.content ?? null
          : target.content ?? null;
      const existingTagged = tiptapJsonToTagged(targetLiveContent).trim();
      const taggedSave = buildPlotLabTaggedSave(plotLabSaveKind, text, plotLabEpisodeNumber);
      const nextTagged = existingTagged ? `${existingTagged}\n\n${taggedSave}` : taggedSave;

      if (target.id === activeTab.id) {
        editorRef.current?.setFullContent(nextTagged);
        await onFlushPendingSave();
      } else {
        const res = await fetch(`/api/documents/${documentId}/tabs/${target.id}/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: JSON.stringify(taggedTextToTiptapDoc(nextTagged)),
            forceVersion: true,
            versionReason: "plot_lab_confirm",
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not save Plot Lab decision.");
        }
      }

      await onAIJobApplied(target.id);
      setPlotLabSaveOpen(false);
      setNotice(`Saved to ${PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Plot Lab decision.");
    } finally {
      setIsPlotLabSaving(false);
    }
  }, [
    activeTab.id,
    documentId,
    editorRef,
    isPlotLabSaving,
    onAIJobApplied,
    onFlushPendingSave,
    plotLabEpisodeNumber,
    plotLabSaveKind,
    plotLabSaveText,
    tabs,
  ]);

  // ─── Pipeline step helpers ───

  useEffect(() => {
    if (plotLabActive && activeStep) setActiveStep(null);
  }, [activeStep, plotLabActive]);

  useEffect(() => {
    if (!activeStep) return;
    const activeGroup = PIPELINE_STEPS.find((step) => step.id === activeStep)?.group;
    if (activeGroup && activeGroup !== selectedPipelineGroup) setActiveStep(null);
  }, [activeStep, selectedPipelineGroup, PIPELINE_STEPS]);
  const isTabNonEmpty = useCallback((tabType: string): boolean => {
    const t = tabs.find((tab) => tab.type === tabType);
    if (!t?.content) return false;
    const tagged = tiptapJsonToTagged(t.content);
    // Strip H1 stubs so an empty new tab (only "[H1] World State") reads as empty
    const withoutH1 = tagged
      .split("\n")
      .filter((line) => !line.trim().startsWith("[H1]"))
      .join("\n");
    return withoutH1.trim().length > 30;
  }, [tabs]);

  const handleStepClick = useCallback(
    async (stepId: PipelineStepId) => {
      if (isStreaming) return;

      // Always confirm before running a pipeline step — it clears chat history
      // so the agent starts fresh with the right context.
      const step = PIPELINE_STEPS.find((s) => s.id === stepId);
      const stepLabel = step ? getStepLabel(step) : stepId;
      if (history.length > 0 || messages.length > 0) {
        const confirmed = window.confirm(
          `Run "${stepLabel}"?\n\nThis will clear the current chat history and start fresh. Confirm the relevant tabs are updated before continuing.`
        );
        if (!confirmed) return;
      }

      // Clear history (local state + server)
      setHistory([]);
      setMessages([]);
      setStreamingText("");
      setError(null);
      fetch(`/api/ai/chat-history?documentId=${documentId}`, { method: "DELETE" }).catch(() => {});

      setActiveStep(stepId);

      const liveWorkbookContent =
        activeTab.type === "workbook"
          ? (editorRef.current?.getContentJSON?.() ?? null)
          : null;

      const context = buildPipelineStepContext(stepId, tabs, liveWorkbookContent);

      console.debug("[pipeline:step]", {
        stepId,
        activeTabType: activeTab.type,
        usedLiveWorkbook: liveWorkbookContent !== null,
        contextChars: context.length,
      });

      const initialMessage: ChatMessage = {
        role: "user",
        content: context || "(no context available for this step yet)",
      };
      setMessages([initialMessage, { role: "assistant", content: "" }]);

      await sendMessages([initialMessage], {
        selectionAtSubmit: false,
        originTabId: activeTab.id,
        modeOverride: stepId,
      });
    },
    [isStreaming, history, messages, documentId, activeTab, editorRef, tabs, sendMessages, getStepLabel, PIPELINE_STEPS]
  );

  const handleExitStep = useCallback(() => {
    setActiveStep(null);
    setMessages([]);
  }, []);

  // ─── Render ───

  return (
    <div ref={containerRef} className="flex h-full flex-col">

      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h3 className="font-semibold text-indigo-700 leading-tight">{plotLabActive ? "Plot Lab" : "AI Assistant"}</h3>
          {plotLabActive ? (
            <p className="text-[10px] text-indigo-500 leading-tight">Levi workspace agent</p>
          ) : activeStep && (
            <p className="text-[10px] text-indigo-500 leading-tight">
              {getModeLabel(activeStep)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canUsePlotLab ? (
            <button
              type="button"
              onClick={() => onPlotLabActiveChange(!plotLabActive)}
              disabled={isStreaming}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                plotLabActive
                  ? "bg-indigo-600 text-white"
                  : "border border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              Plot Lab
            </button>
          ) : null}
          <button
            onClick={() => {
              if (history.length === 0) return;
              if (window.confirm("Clear all chat history for this document? This cannot be undone.")) {
                handleClearHistory();
              }
            }}
            disabled={history.length === 0 || isStreaming}
            title="Clear chat history"
            aria-label="Clear chat history"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">
            &times;
          </button>
        </div>
      </div>

      {/* ─── Contextual actions ─── */}
      {!plotLabActive && ["microdrama_plots", "predefined_episodes", "characters"].includes(activeTab.type) && (
        <div className="flex-shrink-0 border-b border-border px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Actions</span>
            {activeTab.type === "microdrama_plots" && activeStep && (
              <button
                type="button"
                onClick={handleExitStep}
                className="text-[10px] text-indigo-500 hover:text-indigo-700"
              >
                Exit
              </button>
            )}
          </div>

          {activeTab.type === "microdrama_plots" && (
            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {selectedPipelineGroup === "Monetization Runway"
                  ? "EP1 to monetization"
                  : "Post-monetization continuation"}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {PIPELINE_STEPS.filter((step) => step.group === selectedPipelineGroup).map((step) => {
                  const tabFilled = isTabNonEmpty(step.enabledWhenTabType);
                  const enabled = tabFilled && !isStreaming && !isAIBusy;
                  const isActive = activeStep === step.id;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => handleStepClick(step.id)}
                      disabled={!enabled}
                      title={!tabFilled ? "Fill " + step.requiredTabLabel + " tab first" : undefined}
                      className={`rounded px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors
                        ${isActive
                          ? "bg-indigo-600 text-white"
                          : enabled
                          ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                          : "cursor-not-allowed bg-muted text-muted-foreground"
                        }`}
                    >
                      <span className="block">{getStepLabel(step)}</span>
                      {!tabFilled && (
                        <span className="mt-0.5 block text-[9px] font-normal leading-tight text-muted-foreground">
                          Fill {step.requiredTabLabel}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab.type === "predefined_episodes" && (
            <button
              type="button"
              onClick={() => void handleOpenPredefinedLab()}
              disabled={isOpeningPredefinedLab}
              aria-busy={isOpeningPredefinedLab}
              className="w-full rounded bg-emerald-50 px-3 py-2 text-left text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              {isOpeningPredefinedLab ? "Opening…" : "Open Predefined Lab"}
            </button>
          )}

          {activeTab.type === "characters" && (
            <button
              type="button"
              onClick={() => void handleAddCharacterHeading()}
              disabled={isStreaming || isAIBusy}
              className="w-full rounded border border-border bg-card px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              Add Character
            </button>
          )}
        </div>
      )}
      {/* ─── Messages / Streaming — takes all remaining space ─── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">

        {/* Empty state */}
        {history.length === 0 && messages.length === 0 && !isStreaming && (
          <div className="py-8 text-center text-[13px] text-muted-foreground">
            {assistantEmptyState(activeTab.type, plotLabActive)}
          </div>
        )}

        {/* Full history */}
        {history.map((entry, i) => {
          if (entry.type === "mode-change") {
            return (
              <div key={`mc-${i}`} className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-orange-300" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 whitespace-nowrap">
                  {getModeLabel(entry.mode)}
                </span>
                <div className="flex-1 h-px bg-orange-300" />
              </div>
            );
          }
          return (
            <div
              key={`h-${i}`}
              className={entry.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  entry.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-card border border-border text-foreground"
                }`}
              >
                {entry.role === "assistant" ? (
                  <div className="space-y-2">
                    <AssistantMessage
                      content={entry.content}
                      mode={entry.mode}
                      isStreaming={false}
                      actionsEnabled={i === latestActionableHistoryIndex}
                      onPlotLabDecision={entry.mode === "plot_lab_chat" ? handlePlotLabDecision : undefined}
                    />
                    {entry.mode === "plot_lab_save_preview" && i === latestActionableHistoryIndex && (
                      <button
                        type="button"
                        onClick={() => openPlotLabSave(entry.content)}
                        className="min-h-11 rounded border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        Save with confirmation
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{entry.content}</div>
                )}
              </div>
            </div>
          );
        })}

        {/* Active aiJob (Create Pre-defined Episode) */}
        {aiJob.state.status !== "idle" && (
          <>
            {aiJob.state.kind && (
              <div className="flex justify-end">
                <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-indigo-600 text-white">
                  {JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind}
                </div>
              </div>
            )}
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-card border border-indigo-200 dark:border-indigo-800 text-foreground space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                  <span className="text-indigo-700">{aiJob.state.kind ? (JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind) : "AI"}</span>
                  <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-indigo-700 dark:text-indigo-300 normal-case capitalize">
                    {aiJob.state.status}
                  </span>
                </div>
                {aiJob.state.error && (
                  <div className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{aiJob.state.error}</div>
                )}
                {aiJob.state.output && (
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-foreground">
                    {stripTagsForDisplay(aiJob.state.output)}
                  </pre>
                )}
                {(aiJob.state.status === "starting" || aiJob.state.status === "running") && !aiJob.state.output && (
                  <div className="flex items-center gap-2 text-xs text-indigo-600">
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                    Generating
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {(aiJob.state.status === "starting" || aiJob.state.status === "running") && (
                    <button onClick={aiJob.cancel} className="flex-1 rounded-md border border-red-200 dark:border-red-800 bg-card px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                      Cancel
                    </button>
                  )}
                  {aiJob.state.status === "completed" && aiJob.state.output && (
                    <>
                      <button onClick={handleDiscardJob} className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
                        Discard
                      </button>
                      <button
                        onClick={handleApplyJob}
                        disabled={isApplyingJob}
                        className="flex-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isApplyingJob ? "Applying..." : "Append to Workbook"}
                      </button>
                    </>
                  )}
                  {(aiJob.state.status === "failed" || aiJob.state.status === "cancelled") && (
                    <button onClick={aiJob.reset} className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Live streaming output */}
        {isStreaming && isPlotLabMode(mode) && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground">
              <div className="flex items-center gap-3">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
                <span className="text-sm leading-6 text-muted-foreground">
                  Levi is reading the saved context and preparing the next clean decision.
                </span>
              </div>
            </div>
          </div>
        )}
        {isStreaming && streamingText && !isPlotLabMode(mode) && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-card border border-border text-foreground">
              <AssistantMessage content={streamingText} mode={mode} isStreaming={true} />
            </div>
          </div>
        )}

        {/* Waiting indicator */}
        {isStreaming && !streamingText && !isPlotLabMode(mode) && (
          <div className="flex items-center gap-2 py-2 text-indigo-600">
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {notice}
          </div>
        )}
      </div>

      {/* ─── Drag handle ─── */}
      <div
        onMouseDown={handleResizeStart}
        className="group flex h-2.5 flex-shrink-0 cursor-ns-resize items-center justify-center bg-muted hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors select-none"
        title="Drag to resize"
      >
        <div className="h-0.5 w-8 rounded-full bg-border group-hover:bg-indigo-400 transition-colors" />
      </div>

      {/* ─── Input panel ─── */}
      <div
        style={{ height: inputPanelHeight }}
        className="flex flex-shrink-0 flex-col border-t border-border px-3 pt-2 pb-2 gap-2 overflow-hidden"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={plotLabActive ? "Chat with Levi..." : "What would you like to do?"}
          disabled={isStreaming}
          className={`min-h-0 flex-1 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none transition-colors ${
            isStreaming
              ? "border-border bg-muted text-muted-foreground cursor-not-allowed"
              : "border-border bg-card"
          }`}
          onKeyDown={(e) => {
            if (handleTextareaLineMoveKeyDown(e)) return;
            if (e.key === "Enter") {
              if (sendOnEnter && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                handleSubmit();
              } else if (!sendOnEnter && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isStreaming || !input.trim()}
          className="w-full flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {isStreaming ? "Generating..." : "Send"}
        </button>
        <div className="flex flex-shrink-0 justify-center">
          <div className="flex rounded-full border border-border overflow-hidden text-xs">
            <button
              onClick={() => { setSendOnEnter(false); localStorage.setItem("ai-send-on-enter", "false"); }}
              className={`px-3 py-1 transition-colors ${!sendOnEnter ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium" : "bg-card text-muted-foreground hover:text-muted-foreground"}`}
            >
              ⌘+Enter
            </button>
            <button
              onClick={() => { setSendOnEnter(true); localStorage.setItem("ai-send-on-enter", "true"); }}
              className={`px-3 py-1 transition-colors border-l border-border ${sendOnEnter ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium" : "bg-card text-muted-foreground hover:text-muted-foreground"}`}
            >
              Enter
            </button>
          </div>
        </div>
      </div>
      {plotLabSaveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-background p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Confirm system-of-record save</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  This will append to {PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]} after confirmation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlotLabSaveOpen(false)}
                className="text-lg leading-none text-muted-foreground hover:text-foreground"
              >
                &times;
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Save as
                <select
                  value={plotLabSaveKind}
                  onChange={(event) => setPlotLabSaveKind(event.target.value as PlotLabSaveKind)}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  {Object.entries(PLOT_LAB_SAVE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              {(plotLabSaveKind === "episode_sketch_lock" || plotLabSaveKind === "final_plot_commit") && (
                <label className="block text-xs font-medium text-muted-foreground">
                  Episode number
                  <input
                    value={plotLabEpisodeNumber}
                    onChange={(event) => setPlotLabEpisodeNumber(event.target.value.replace(/[^\d]/g, ""))}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    placeholder="Optional"
                  />
                </label>
              )}
              <label className="block text-xs font-medium text-muted-foreground">
                Text to save
                <textarea
                  value={plotLabSaveText}
                  onChange={(event) => setPlotLabSaveText(event.target.value)}
                  onKeyDown={handleTextareaLineMoveKeyDown}
                  rows={8}
                  className="mt-1 w-full resize-y rounded border border-border bg-background px-2.5 py-2 text-sm text-foreground"
                />
              </label>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Destination: {PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]}. This is the double-confirm step before Plot Lab changes a canonical tab.
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPlotLabSaveOpen(false)}
                  disabled={isPlotLabSaving}
                  className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmPlotLabSave()}
                  disabled={isPlotLabSaving || !plotLabSaveText.trim()}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isPlotLabSaving ? "Saving..." : "Confirm save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Assistant message renderer ───

function AssistantMessage({
  content,
  mode,
  isStreaming,
  actionsEnabled = true,
  onPlotLabDecision,
}: {
  content: string;
  mode: Mode;
  isStreaming: boolean;
  actionsEnabled?: boolean;
  onPlotLabDecision?: (decisionText: string, sourceAssistantText?: string) => void;
}) {
  const displayContent = normalizeAssistantDisplayContent(content);
  if (!displayContent) return null;
  const plotLabChoices =
    mode === "plot_lab_chat" && !isStreaming && actionsEnabled && onPlotLabDecision
      ? parsePlotLabChoices(displayContent)
      : null;
  const quickChoices =
    mode === "plot_lab_chat" && !isStreaming && actionsEnabled && onPlotLabDecision
      ? parseInlinePlotLabQuickChoices(displayContent)
      : [];
  if (plotLabChoices) {
    const extraQuickChoices = quickChoices.filter(
      (quick) => !plotLabChoices.choices.some((choice) => choice.key.toLowerCase() === quick.key.toLowerCase())
    );
    return (
      <div className="space-y-3">
        {plotLabChoices.prompt && (
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-foreground">{plotLabChoices.prompt}</div>
        )}
        <div className="space-y-2 rounded-md border border-border bg-background/70 p-2">
          <div className="px-1 text-[11px] font-semibold uppercase text-muted-foreground">Choose next</div>
          {plotLabChoices.choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => onPlotLabDecision?.(choice.response, content)}
              className="group block min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950/30"
            >
              <span className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                  {choice.key}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{choice.label}</span>
                  {choice.detail && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{choice.detail}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
        {plotLabChoices.after && (
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{plotLabChoices.after}</div>
        )}
        {onPlotLabDecision && extraQuickChoices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {extraQuickChoices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                onClick={() => {
                  if (choice.response) onPlotLabDecision(choice.response, content);
                }}
                className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (quickChoices.length > 0) {
    return (
      <div className="space-y-3">
        <div className="whitespace-pre-wrap text-[13px] leading-6 text-foreground">{displayContent}</div>
        <div className="flex flex-wrap gap-2">
          {quickChoices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => {
                if (choice.response) onPlotLabDecision?.(choice.response, content);
              }}
              className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950/30"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap text-[13px] leading-6">
      {displayContent}
      {isStreaming && (
        <span className="inline-block ml-1 h-3 w-1.5 bg-indigo-500 animate-pulse" />
      )}
    </div>
  );
}
