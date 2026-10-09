"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Download, Loader2, Send, Trash2, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { EditorHandle } from "@/components/editor/Editor";
import type { TabRow } from "@/components/editor/TabRail";
import { buildPlotLabContext, tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { handleTextareaLineMoveKeyDown } from "@/lib/editing/line-move";
import { taggedTextToTiptapDoc } from "@/lib/editor/tagged-parser";
import {
  commitPlotLabAssistantTurn,
  createInitialPlotLabControllerState,
  planPlotLabAssistantTurn,
  renderPlotLabControllerDirective,
  type PlotLabAction,
  type PlotLabActionKind,
  type PlotLabChatMessage,
  type PlotLabControllerState,
  type PlotLabTurnPlan,
  type PlotLabUserIntent,
} from "@/lib/plot-lab/controller";
import {
  parseSpecialistBrief,
  renderPlotLabRuntimeInput,
  renderSpecialistOutputContract,
  selectPlotLabSpecialist,
  specialistBriefToLeviContext,
  specialistOptionsToActions,
  type PlotLabSpecialistBrief,
  type PlotLabSpecialistMode,
} from "@/lib/plot-lab/orchestration";

interface PlotLabWorkspaceProps {
  documentId: string;
  tabs: TabRow[];
  activeTab: TabRow;
  editorRef: RefObject<EditorHandle | null>;
  modelId: string;
  thinking: boolean;
  isAdmin: boolean;
  canUseTesterTools: boolean;
  onFlushPendingSave: () => Promise<void>;
  onTabsChange: (tabs: TabRow[]) => void;
  onOpenTab: (tabId: string) => Promise<void>;
  onClose: () => void;
}

type ChatMessage = PlotLabChatMessage;

type PlotLabAnswerSource = "freeform" | "option_click" | "edited_option" | "utility_action";

interface PlotLabFeedbackEvent {
  messageIndex: number;
  rating: "up" | "down";
  note: string;
  assistantText: string;
  previousUserText: string;
  controllerState: {
    phase: string;
    focus: string;
    questionCount: string;
    nextMove: string;
    monetizationStatus: string;
    waitingFor: string;
    saveTarget: string;
    specialist: string;
    responseSource: string;
    lockedContextUsed: string[];
  };
  contextSnapshot: PlotLabMessageMeta["contextSnapshot"] | null;
  createdAt: string;
}

interface PlotLabMessageMeta {
  source?: "ai" | "app" | "writer";
  answerSource?: PlotLabAnswerSource;
  writerVisibleText?: string;
  controllerIntent?: string;
  selectedAction?: {
    actionId: string;
    label: string;
    detail: string;
    response: string;
    kind: PlotLabActionKind;
  };
  specialistMode?: PlotLabSpecialistMode;
  specialistBrief?: PlotLabSpecialistBrief | null;
  specialistParseError?: string | null;
  auditBrief?: string;
  structuredActions?: PlotLabAction[];
  controllerSnapshot?: {
    phase: string;
    focus: string;
    turnKind: string;
    questionVector: string;
    frameworkSlot: string;
    questionMode: string;
    questionCount: string;
    waitingFor: string;
    lastUserIntent: PlotLabUserIntent;
  };
  turnPlan?: PlotLabTurnPlan;
  contextSnapshot?: {
    capturedAt: string;
    activeTab: {
      id: string;
      title: string;
      type: string;
    };
    documentTabs: Array<{
      id: string;
      title: string;
      type: string;
      position: number;
      isActive: boolean;
    }>;
    contextBlock: string;
    plotLabDecisions: string;
    recentChat: string;
    controllerDirective: string;
    specialistMode: PlotLabSpecialistMode;
    runtimeInput: string;
  };
}

type PlotLabMessage = ChatMessage & {
  meta?: PlotLabMessageMeta;
};

interface SendToLeviOptions {
  promptText?: string;
  displayText?: string;
  replaceLatestAssistant?: boolean;
  advanceController?: boolean;
  appendUserMessage?: boolean;
  baseMessages?: PlotLabMessage[];
  controllerStateOverride?: ReturnType<typeof createInitialPlotLabControllerState>;
  answerSource?: PlotLabAnswerSource;
  selectedAction?: PlotLabAction;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 680;
const DEFAULT_WIDTH = 420;

const STATE_LABELS: Record<string, string> = {
  opening_read: "Opening read",
  awaiting_context: "Adding context",
  role_board_check: "Role check",
  protagonist_discovery: "Character work",
  character_discovery: "Character work",
  relationship_discovery: "Universe work",
  character_summary: "Character summary",
  plot_transition_gate: "Ready for plot",
  monetization_discovery: "Monetization",
  monetization_lock_review: "Monetization review",
  premise_bridge: "Universe bridge",
  stage_1_complete: "Stage 1 locked",
  plot_thread: "Plot runway",
};

const FOCUS_LABELS: Record<string, string> = {
  opening: "Opening",
  protagonist: "Protagonist",
  primary_counterpart: "Primary counterpart",
  operator_pressure: "Pressure/operator",
  relationship_core: "Relationship core",
  plot: "Plot",
};

function cleanAssistantText(text: string): string {
  return text
    .replace(/^[012]\n/, "")
    .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")
    .split("\n")
    .map((line) => line.replace(/^\[(?:H\d|OL|UL|P|HR)\]\s*/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function controlledPromptForAction(action: PlotLabAction, latestAssistantText: string): string {
  if (action.kind === "confirm_opening") {
    return "Yes, this is right";
  }
  if (action.kind === "lock_current") {
    return "Lock this";
  }
  if (action.kind === "continue_here") {
    return "Continue here";
  }
  if (action.kind === "revise_current") {
    return "Revise this";
  }
  if (action.kind === "move_into_plot") {
    return "Move into plot";
  }
  if (action.kind === "stay_character") {
    return "Stay at character level";
  }
  if (action.kind === "reroll_options") {
    return [
      "Reroll the current question or option set.",
      "Stay open-ended, high-level, and EP1-grounded.",
      "Do not move into plot beats, tactics, scene logistics, deal terms, or next actions.",
      "If this is monetization, give at most 3 one-sentence options.",
      "If this is character work, ask one fresh broader question.",
      `Previous Levi question:\n${latestAssistantText}`,
    ].join("\n\n");
  }
  return action.response;
}

function getThinkingText(messages: PlotLabMessage[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  if (/expand plot 1|character functions|pressure turns/i.test(lastUser)) {
    return "Levi is shaping the first small lock";
  }
  return "Levi is thinking";
}

function renderRecentChat(messages: PlotLabMessage[]): string {
  const recent = messages.slice(-8);
  if (recent.length === 0) return "";
  return [
    "## Recent Levi Chat",
    ...recent.map((message) => {
      const speaker = message.role === "user" ? "Writer" : "Levi";
      return `${speaker}: ${message.content}`;
    }),
  ].join("\n\n");
}

function lockedSummary(state: ReturnType<typeof createInitialPlotLabControllerState>): string[] {
  const locks: string[] = [];
  if (state.completedFocuses.includes("protagonist") || state.roleSlots.protagonist === "locked") {
    locks.push("Protagonist pass");
  }
  if (state.completedFocuses.includes("primary_counterpart") || state.roleSlots.primary_counterpart === "locked") {
    locks.push("Primary counterpart pass");
  }
  if (state.completedFocuses.includes("operator_pressure") || state.roleSlots.operator_pressure === "locked") {
    locks.push("Pressure/operator pass");
  }
  if (state.completedFocuses.includes("relationship_core")) {
    locks.push("Relationship core");
  }
  if (state.monetizationStatus === "locked") {
    locks.push("Monetization point");
  }
  if (state.monetizationStatus === "skipped") {
    locks.push("Monetization skipped");
  }
  return locks.length ? locks : ["Nothing locked yet"];
}

function previousUserText(messages: PlotLabMessage[], messageIndex: number): string {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index].content;
  }
  return "";
}

function plainTextToTaggedParagraphs(text: string): string[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length
    ? lines.map((line) => `[P] ${line}`)
    : ["[P] No lock text captured."];
}

function decisionSectionTitle(state: ReturnType<typeof createInitialPlotLabControllerState>): string {
  if (state.phase === "monetization_lock_review") return "Monetization Endpoint";
  if (state.phase === "premise_bridge") return "Universe Lock";
  if (state.phase === "stage_1_complete") return "Stage 1 Complete";
  if (state.focusId === "relationship_core" || state.phase === "plot_transition_gate") return "Relationship / Pressure Chain";
  if (state.focusId === "plot") return "Monetization Endpoint";
  return "Character Locks";
}

function decisionBlockTitle(state: ReturnType<typeof createInitialPlotLabControllerState>): string {
  if (state.focusId === "protagonist") return "Protagonist";
  if (state.focusId === "primary_counterpart") return "Primary Counterpart";
  if (state.focusId === "operator_pressure") return "Operator / Pressure Face";
  if (state.focusId === "relationship_core") return "Relationship Core";
  if (state.phase === "premise_bridge") return "Delta Lock";
  if (state.phase === "stage_1_complete") return "Stage 1 Lock";
  if (state.phase === "monetization_lock_review" || state.focusId === "plot") return "Endpoint";
  return STATE_LABELS[state.phase] ?? state.phase;
}

function sectionHeading(level: 2 | 3, title: string): string {
  return `[H${level}] ${title}`;
}

function upsertDecisionBlock(existingTagged: string, sectionTitle: string, blockTitle: string, bodyText: string): string {
  const normalized = existingTagged.trim() || "[H1] Plot Lab Decisions";
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => line.startsWith("[H1]"))) {
    lines.unshift("[H1] Plot Lab Decisions");
  }

  const sectionHeader = sectionHeading(2, sectionTitle);
  let sectionStart = lines.findIndex((line) => line === sectionHeader);
  if (sectionStart === -1) {
    lines.push(sectionHeader);
    sectionStart = lines.length - 1;
  }

  let sectionEnd = lines.findIndex((line, index) => index > sectionStart && line.startsWith("[H2] "));
  if (sectionEnd === -1) sectionEnd = lines.length;

  const blockHeader = sectionHeading(3, blockTitle);
  const blockLines = [blockHeader, ...plainTextToTaggedParagraphs(bodyText)];
  const blockStart = lines.findIndex((line, index) => index > sectionStart && index < sectionEnd && line === blockHeader);

  if (blockStart === -1) {
    lines.splice(sectionEnd, 0, ...blockLines);
    return lines.join("\n");
  }

  let blockEnd = lines.findIndex((line, index) => index > blockStart && (line.startsWith("[H3] ") || line.startsWith("[H2] ")));
  if (blockEnd === -1) blockEnd = lines.length;
  lines.splice(blockStart, blockEnd - blockStart, ...blockLines);
  return lines.join("\n");
}

function defaultPlotLabDecisionsContent(): string {
  return JSON.stringify(taggedTextToTiptapDoc("[H1] Plot Lab Decisions"));
}

function focusHandoffLabel(state: ReturnType<typeof createInitialPlotLabControllerState>): string {
  if (state.focusId === "plot") {
    if (state.phase === "monetization_discovery") return "monetization point";
    if (state.phase === "premise_bridge") return "universe bridge";
    if (state.phase === "stage_1_complete") return "stage 1 lock";
    if (state.phase === "plot_thread") return "plot runway";
    return "plot";
  }
  return FOCUS_LABELS[state.focusId] ?? state.currentFocus;
}

function renderBriefAsAssistantText(brief: PlotLabSpecialistBrief | null): string {
  if (!brief) return "";
  return cleanAssistantText([
    brief.visibleFrame?.trim(),
    brief.question?.trim(),
  ].filter(Boolean).join("\n\n"));
}

function renderReviewAssistantText(brief: PlotLabSpecialistBrief | null): string {
  if (!brief) return "";
  return cleanAssistantText([
    brief.visibleFrame?.trim(),
    brief.lockCandidate?.text?.trim(),
  ].filter(Boolean).join("\n\n"));
}

function auditQuestionNeeded(auditBrief: string): string {
  const match = auditBrief.match(/Question needed:\s*(.+)$/im);
  if (!match?.[1]) return "";
  const question = match[1].replace(/^<none>|^none$/i, "").trim();
  return question.includes("?") ? question : "";
}

function auditVerdict(auditBrief: string): "pass" | "needs_tweak" | "block" | "unknown" {
  const match = auditBrief.match(/Verdict:\s*\*?\*?(Pass|Needs tweak|Block)/i);
  const verdict = match?.[1]?.toLowerCase();
  if (verdict === "pass") return "pass";
  if (verdict === "needs tweak") return "needs_tweak";
  if (verdict === "block") return "block";
  return "unknown";
}

function hasLockAction(state: PlotLabControllerState): boolean {
  return state.turnPlan.actions.some((action) => action.kind === "lock_current");
}

function isLockReviewTurn(state: PlotLabControllerState): boolean {
  return hasLockAction(state) || state.waitingFor === "approve_lock";
}

function isDeterministicReviewTurn(state: PlotLabControllerState): boolean {
  return isLockReviewTurn(state) || state.phase === "stage_1_complete";
}

function hasInlineMenu(text: string): boolean {
  return /\b(?:[abc]|\d)\)|\b(?:A|B|C)\s*[-:]/.test(text);
}

function isSafeAuditQuestion(question: string): boolean {
  const trimmed = question.trim();
  return Boolean(trimmed) && trimmed.includes("?") && !hasInlineMenu(trimmed);
}

function stripVisibleQuestions(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !paragraph.includes("?"));
  return paragraphs.join("\n\n").trim();
}

function reviewFallbackText(brief: PlotLabSpecialistBrief | null, assistantText: string): string {
  return cleanAssistantText([
    brief?.visibleFrame?.trim(),
    brief?.lockCandidate?.text?.trim(),
    assistantText.split("?")[0]?.trim(),
  ].filter(Boolean)[0] ?? "");
}

function controllerSnapshot(state: PlotLabControllerState): NonNullable<PlotLabMessageMeta["controllerSnapshot"]> {
  return {
    phase: state.phase,
    focus: state.currentFocus,
    turnKind: state.assistantTurnKind,
    questionVector: state.questionVector,
    frameworkSlot: state.frameworkSlot,
    questionMode: state.questionMode,
    questionCount: `${state.questionsInFocus}/${state.maxQuestionsPerFocus}`,
    waitingFor: state.waitingFor,
    lastUserIntent: state.lastUserIntent,
  };
}

async function readAIStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  if (!reader) return accumulated;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
  }
  return accumulated;
}

export default function PlotLabWorkspace({
  documentId,
  tabs,
  activeTab,
  editorRef,
  modelId,
  thinking,
  isAdmin,
  canUseTesterTools,
  onFlushPendingSave,
  onTabsChange,
  onOpenTab,
  onClose,
}: PlotLabWorkspaceProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<PlotLabMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCapturingContext, setIsCapturingContext] = useState(false);
  const [feedbackEvents, setFeedbackEvents] = useState<PlotLabFeedbackEvent[]>([]);
  const [controllerState, setControllerState] = useState(createInitialPlotLabControllerState);
  const [lockSaveStatus, setLockSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lockSaveMessage, setLockSaveMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const widthRef = useRef(DEFAULT_WIDTH);
  const plotLabDecisionsContentRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("plot-lab-pane-width"));
      if (Number.isFinite(saved)) {
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, saved));
        widthRef.current = next;
        setWidth(next);
      }
    } catch {
      // localStorage is best effort.
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingText, isStreaming]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem("plot-lab-pane-width", String(widthRef.current));
      } catch {
        // ignore persistence failure
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const plotLabDecisionsTab = tabs.find((tab) => tab.type === "plot_lab_decisions") ?? null;

  useEffect(() => {
    plotLabDecisionsContentRef.current = plotLabDecisionsTab?.content ?? null;
  }, [plotLabDecisionsTab?.content]);

  const saveDecisionLock = useCallback(async (
    assistantText: string,
    meta?: PlotLabMessageMeta,
    stateForSave: PlotLabControllerState = controllerState
  ) => {
    if (!plotLabDecisionsTab) {
      setLockSaveStatus("error");
      setLockSaveMessage("Plot Lab Decisions tab not found.");
      return false;
    }

    const sectionTitle = decisionSectionTitle(stateForSave);
    const blockTitle = decisionBlockTitle(stateForSave);
    const existingTagged = tiptapJsonToTagged(plotLabDecisionsContentRef.current);
    const lockText = meta?.specialistBrief?.lockCandidate?.text?.trim() || assistantText;
    const nextTagged = upsertDecisionBlock(existingTagged, sectionTitle, blockTitle, lockText);
    const content = JSON.stringify(taggedTextToTiptapDoc(nextTagged));

    setLockSaveStatus("saving");
    setLockSaveMessage(`Saving to ${plotLabDecisionsTab.title}...`);

    const res = await fetch(`/api/documents/${documentId}/tabs/${plotLabDecisionsTab.id}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        forceVersion: true,
        versionReason: "plot_lab_lock",
      }),
    });

    if (!res.ok) {
      setLockSaveStatus("error");
      setLockSaveMessage(`Save failed (${res.status}).`);
      return false;
    }

    onTabsChange(tabs.map((tab) =>
      tab.id === plotLabDecisionsTab.id
        ? { ...tab, content, updatedAt: new Date() }
        : tab
    ));
    plotLabDecisionsContentRef.current = content;
    await onOpenTab(plotLabDecisionsTab.id);
    setLockSaveStatus("saved");
    setLockSaveMessage(`Saved to ${plotLabDecisionsTab.title} / ${sectionTitle}.`);
    return true;
  }, [controllerState, documentId, onOpenTab, onTabsChange, plotLabDecisionsTab, tabs]);

  const clearPlotLabDecisions = useCallback(async (): Promise<boolean> => {
    if (!plotLabDecisionsTab || isStreaming) return false;

    const content = defaultPlotLabDecisionsContent();
    setLockSaveStatus("saving");
    setLockSaveMessage(`Clearing ${plotLabDecisionsTab.title}...`);

    const res = await fetch(`/api/documents/${documentId}/tabs/${plotLabDecisionsTab.id}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        forceVersion: true,
        versionReason: "plot_lab_test_reset",
      }),
    });

    if (!res.ok) {
      setLockSaveStatus("error");
      setLockSaveMessage(`Clear failed (${res.status}).`);
      return false;
    }

    onTabsChange(tabs.map((tab) =>
      tab.id === plotLabDecisionsTab.id
        ? { ...tab, content, updatedAt: new Date() }
        : tab
    ));
    plotLabDecisionsContentRef.current = content;
    await onOpenTab(plotLabDecisionsTab.id);
    setLockSaveStatus("saved");
    setLockSaveMessage(`${plotLabDecisionsTab.title} cleared for testing.`);
    return true;
  }, [documentId, isStreaming, onOpenTab, onTabsChange, plotLabDecisionsTab, tabs]);

  const startOver = useCallback(async () => {
    if (isStreaming) return;
    const confirmed = window.confirm(
      "Start over for this Plot Lab test? This clears the visible Levi chat and resets Plot Lab Decisions for this document."
    );
    if (!confirmed) return;
    const cleared = await clearPlotLabDecisions();
    if (!cleared) return;
    setMessages([]);
    setFeedbackEvents([]);
    setControllerState(createInitialPlotLabControllerState());
    setInput("");
    setError(null);
    setStreamingText("");
    setIsCapturingContext(false);
  }, [clearPlotLabDecisions, isStreaming]);

  const sendToLevi = useCallback(async (override?: SendToLeviOptions | string) => {
    const overridePrompt = typeof override === "string" ? override : override?.promptText;
    const replaceLatestAssistant = typeof override === "object" && override.replaceLatestAssistant === true;
    const advanceController = typeof override === "object" && override.advanceController === false ? false : true;
    const appendUserMessage = typeof override === "object" && override.appendUserMessage === false ? false : true;
    const prompt = (overridePrompt ?? input).trim();
    if (!prompt || isStreaming) return;

    const displayText = ((typeof override === "object" ? override.displayText : undefined) ?? input.trim()) || prompt;
    const messageSource = typeof override === "object" && override.baseMessages ? override.baseMessages : messages;
    const answerSource = typeof override === "object" ? override.answerSource ?? "freeform" : "freeform";
    const selectedAction = typeof override === "object" ? override.selectedAction : undefined;
    const plannedControllerState = typeof override === "object" && override.controllerStateOverride
      ? override.controllerStateOverride
      : advanceController
        ? planPlotLabAssistantTurn(controllerState, prompt)
        : controllerState;
    const userMessage: PlotLabMessage = {
      role: "user",
      content: displayText,
      meta: {
        source: "writer",
        answerSource,
        writerVisibleText: displayText,
        controllerIntent: prompt,
        selectedAction: selectedAction
          ? {
              actionId: selectedAction.actionId,
              label: selectedAction.label,
              detail: selectedAction.detail,
              response: selectedAction.response,
              kind: selectedAction.kind,
            }
          : undefined,
        controllerSnapshot: controllerSnapshot(plannedControllerState),
        turnPlan: plannedControllerState.turnPlan,
      },
    };
    const baseMessages = replaceLatestAssistant && messageSource[messageSource.length - 1]?.role === "assistant"
      ? messageSource.slice(0, -1)
      : messageSource;
    const nextMessages = appendUserMessage ? [...baseMessages, userMessage] : baseMessages;
    setMessages(nextMessages);
    setInput("");
    setIsCapturingContext(false);
    setError(null);
    setStreamingText("");
    setIsStreaming(true);

    try {
      await onFlushPendingSave();
      const liveContent = editorRef.current?.getContentJSON() ?? null;
      const plotLabDecisionsContent = plotLabDecisionsContentRef.current ?? plotLabDecisionsTab?.content ?? null;
      const contextTabs = plotLabDecisionsTab
        ? tabs.map((tab) =>
            tab.id === plotLabDecisionsTab.id
              ? { ...tab, content: plotLabDecisionsContent }
              : tab
          )
        : tabs;
      const activeTabLiveContent = activeTab.type === "plot_lab_decisions"
        ? plotLabDecisionsContent
        : liveContent;
      const contextBlock = buildPlotLabContext({
        tabs: contextTabs,
        activeTab,
        activeTabLiveContent,
        userMessage: prompt,
      });
      const recentChat = renderRecentChat(nextMessages);
      const controllerDirective = renderPlotLabControllerDirective(plannedControllerState);
      const specialistRoute = selectPlotLabSpecialist(plannedControllerState);
      const previousAssistant = replaceLatestAssistant && messageSource[messageSource.length - 1]?.role === "assistant"
        ? messageSource[messageSource.length - 1]
        : null;
      const decisionsTagged = plotLabDecisionsTab
        ? tiptapJsonToTagged(plotLabDecisionsContent)
        : "";
      const runtimeInput = renderPlotLabRuntimeInput({
        controllerState: plannedControllerState,
        writerMove: prompt,
        writerVisibleText: displayText,
        controllerIntent: prompt,
        answerSource,
        selectedAction,
        recentChat,
        controllerDirective,
        contextBlock,
        plotLabDecisions: decisionsTagged,
        previousAssistantText: previousAssistant?.content,
        previousOptions: previousAssistant?.meta?.structuredActions?.map((action) => ({
          label: action.label,
          detail: action.detail,
          response: action.response,
        })),
      }, specialistRoute);
      const contextSnapshot: NonNullable<PlotLabMessageMeta["contextSnapshot"]> = {
        capturedAt: new Date().toISOString(),
        activeTab: {
          id: activeTab.id,
          title: activeTab.title,
          type: activeTab.type,
        },
        documentTabs: tabs
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((tab) => ({
            id: tab.id,
            title: tab.title,
            type: tab.type,
            position: tab.position,
            isActive: tab.id === activeTab.id,
          })),
        contextBlock,
        plotLabDecisions: decisionsTagged,
        recentChat,
        controllerDirective,
        specialistMode: specialistRoute.mode,
        runtimeInput,
      };
      const contextualizedNextMessages = nextMessages.map((message, index) =>
        appendUserMessage && index === nextMessages.length - 1 && message.role === "user"
          ? { ...message, meta: { ...message.meta, contextSnapshot } }
          : message
      );
      if (appendUserMessage) setMessages(contextualizedNextMessages);

      const specialistRes = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: [
              runtimeInput,
              renderSpecialistOutputContract(),
            ].filter(Boolean).join("\n\n"),
          }],
          mode: specialistRoute.mode,
          modelId,
          thinking,
          documentId,
        }),
      });

      let specialistRaw = "";
      let specialistBrief: PlotLabSpecialistBrief | null = null;
      let specialistParseError: string | null = null;
      let auditBrief = "";

      if (specialistRes.ok) {
        specialistRaw = await readAIStream(specialistRes);
        const parsed = parseSpecialistBrief(specialistRaw);
        specialistBrief = parsed.brief;
        specialistParseError = parsed.error;
      } else {
        specialistParseError = `specialist request failed (${specialistRes.status})`;
      }

      if (specialistRoute.auditAfter && specialistBrief) {
        const auditRes = await fetch("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{
              role: "user",
              content: [
                runtimeInput,
                "## Proposed Specialist Move",
                JSON.stringify(specialistBrief, null, 2),
                "## Audit Instruction",
                "Audit this proposed move against locked canon, repetition, phase objective, and question quality. Return a compact internal audit for Levi.",
              ].filter(Boolean).join("\n\n"),
            }],
            mode: "plot_lab_continuity_audit",
            modelId,
            thinking,
            documentId,
          }),
        });
        if (auditRes.ok) {
          auditBrief = cleanAssistantText(await readAIStream(auditRes));
        }
      }

      const auditQuestion = auditQuestionNeeded(auditBrief);
      if (auditQuestion && specialistBrief) {
        specialistBrief = {
          ...specialistBrief,
          question: isSafeAuditQuestion(auditQuestion) ? auditQuestion : "",
          options: plannedControllerState.turnPlan.allowModelOptions && isSafeAuditQuestion(auditQuestion) ? specialistBrief.options : [],
        };
      }
      if (isDeterministicReviewTurn(plannedControllerState) && specialistBrief) {
        specialistBrief = {
          ...specialistBrief,
          question: "",
          options: [],
        };
      }
      if (auditVerdict(auditBrief) !== "pass" && auditBrief && specialistBrief && !specialistBrief.question && !isDeterministicReviewTurn(plannedControllerState)) {
        specialistBrief = {
          ...specialistBrief,
          visibleFrame: "Let me ask that from a cleaner angle.",
          options: [],
        };
      }

      const structuredActions = specialistOptionsToActions(specialistBrief, plannedControllerState.turnPlan);

      let assistantText = plannedControllerState.turnPlan.allowModelOptions
        ? renderBriefAsAssistantText(specialistBrief)
        : isDeterministicReviewTurn(plannedControllerState)
          ? renderReviewAssistantText(specialistBrief)
        : "";

      if (!assistantText) {
        const res = await fetch("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{
              role: "user",
              content: [
                contextBlock,
                recentChat,
                controllerDirective,
                specialistBriefToLeviContext(specialistBrief, specialistRoute, specialistParseError, auditBrief),
                `## Message\n${prompt}`,
              ].filter(Boolean).join("\n\n"),
            }],
            mode: "plot_lab_chat",
            modelId,
            thinking,
            documentId,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Levi request failed");
        }

        assistantText = cleanAssistantText(await readAIStream(res));
      }
      if (isDeterministicReviewTurn(plannedControllerState) && assistantText.includes("?")) {
        assistantText = stripVisibleQuestions(assistantText) || reviewFallbackText(specialistBrief, assistantText);
      }
      if (
        auditVerdict(auditBrief) !== "pass" &&
        auditBrief &&
        !isDeterministicReviewTurn(plannedControllerState) &&
        hasInlineMenu(assistantText)
      ) {
        assistantText = reviewFallbackText(specialistBrief, assistantText) || "Let me ask that from a cleaner angle.";
      }
      if (assistantText) {
        const assistantMeta: PlotLabMessageMeta = {
          source: "ai",
          specialistMode: specialistRoute.mode,
          specialistBrief,
          specialistParseError,
          auditBrief,
          structuredActions,
          controllerSnapshot: controllerSnapshot(plannedControllerState),
          turnPlan: plannedControllerState.turnPlan,
        };
        setMessages([...contextualizedNextMessages, {
          role: "assistant",
          content: assistantText,
          meta: assistantMeta,
        }]);
        if (plannedControllerState.phase === "stage_1_complete") {
          void saveDecisionLock(assistantText, assistantMeta, plannedControllerState);
        }
        setControllerState(advanceController ? commitPlotLabAssistantTurn(plannedControllerState) : plannedControllerState);
      } else {
        setControllerState(plannedControllerState);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Levi could not complete that request.");
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [activeTab, controllerState, documentId, editorRef, input, isStreaming, messages, modelId, onFlushPendingSave, plotLabDecisionsTab, saveDecisionLock, tabs, thinking]);

  const handleAction = useCallback(async (action: PlotLabAction, latestAssistantText: string, latestMeta?: PlotLabMessageMeta) => {
    if (isStreaming) return;

    if (action.kind === "add_context") {
      setIsCapturingContext(true);
      setInput("");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    if (action.kind === "revise_current") {
      setIsCapturingContext(true);
      setInput("");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    if (action.kind === "custom_answer") {
      setIsCapturingContext(false);
      setInput("");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    if (action.kind === "lock_current") {
      const saved = await saveDecisionLock(latestAssistantText, latestMeta);
      if (!saved) return;

      const nextControllerState = planPlotLabAssistantTurn(controllerState, "Lock this");
      const handoffMessage: PlotLabMessage = {
        role: "assistant",
        content: `Saved to Plot Lab Decisions.\n\nNext focus: ${focusHandoffLabel(nextControllerState)}.`,
        meta: { source: "app" },
      };
      const messagesWithHandoff = [...messages, handoffMessage];
      setMessages(messagesWithHandoff);
      setControllerState(nextControllerState);

      void sendToLevi({
        promptText: "Lock this",
        appendUserMessage: false,
        baseMessages: messagesWithHandoff,
        controllerStateOverride: nextControllerState,
      });
      return;
    }

    const displayText = action.kind === "requested_option" && action.detail
      ? `${action.label}: ${action.detail}`
      : action.label;
    void sendToLevi({
      displayText,
      promptText: controlledPromptForAction(action, latestAssistantText),
      replaceLatestAssistant: action.kind === "reroll_options",
      advanceController: action.kind !== "reroll_options",
      answerSource: action.kind === "requested_option" || action.kind === "confirm_opening" ? "option_click" : "utility_action",
      selectedAction: action,
    });
  }, [controllerState, isStreaming, messages, saveDecisionLock, sendToLevi]);

  const recordFeedback = useCallback((messageIndex: number, rating: "up" | "down", assistantText: string) => {
    const note = rating === "down"
      ? window.prompt("Optional note for this Plot Lab response", "")?.trim() ?? ""
      : "";
    const priorUserMessage = [...messages.slice(0, messageIndex)].reverse().find((message) => message.role === "user");
    setFeedbackEvents((current) => [
      ...current,
      {
        messageIndex,
        rating,
        note,
        assistantText,
        previousUserText: previousUserText(messages, messageIndex),
        controllerState: {
          phase: STATE_LABELS[controllerState.phase] ?? controllerState.phase,
          focus: FOCUS_LABELS[controllerState.focusId] ?? controllerState.currentFocus,
          questionCount: `${controllerState.questionsInFocus}/${controllerState.maxQuestionsPerFocus}`,
          nextMove: controllerState.allowedNextMove,
          monetizationStatus: controllerState.monetizationStatus,
          waitingFor: controllerState.waitingFor,
          saveTarget: plotLabDecisionsTab?.title ?? "Plot Lab Decisions",
          specialist: messages[messageIndex]?.meta?.specialistMode ?? "none",
          responseSource: messages[messageIndex]?.meta?.source ?? "ai",
          lockedContextUsed: messages[messageIndex]?.meta?.specialistBrief?.lockedContextUsed ?? [],
        },
        contextSnapshot: priorUserMessage?.meta?.contextSnapshot ?? null,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, [controllerState, messages, plotLabDecisionsTab]);

  const exportDebugJson = useCallback(() => {
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    const plotLabDecisionsTagged = plotLabDecisionsTab
      ? tiptapJsonToTagged(plotLabDecisionsContentRef.current ?? plotLabDecisionsTab.content ?? null)
      : "";
    const payload = {
      exportedAt: new Date().toISOString(),
      documentId,
      plotLabDecisions: plotLabDecisionsTagged,
      state: {
        currentState: STATE_LABELS[controllerState.phase] ?? controllerState.phase,
        currentFocus: FOCUS_LABELS[controllerState.focusId] ?? controllerState.currentFocus,
        lockedSoFar: lockedSummary(controllerState),
        nextMove: controllerState.allowedNextMove,
        waitingFor: controllerState.waitingFor,
        monetizationStatus: controllerState.monetizationStatus,
        questionVector: controllerState.questionVector,
        questionCount: `${controllerState.questionsInFocus}/${controllerState.maxQuestionsPerFocus}`,
        saveTarget: plotLabDecisionsTab?.title ?? "Plot Lab Decisions",
        activeSpecialist: latestAssistant?.meta?.specialistMode ?? "none",
        lockedContextUsed: latestAssistant?.meta?.specialistBrief?.lockedContextUsed ?? [],
        specialistParseError: latestAssistant?.meta?.specialistParseError ?? null,
        currentTurnPlan: controllerState.turnPlan,
      },
      userTurns: messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message.role === "user")
        .map(({ message, index }) => ({
          index,
          content: message.content,
          answerSource: message.meta?.answerSource ?? "unknown",
          writerVisibleText: message.meta?.writerVisibleText ?? message.content,
          controllerIntent: message.meta?.controllerIntent ?? message.content,
          selectedAction: message.meta?.selectedAction ?? null,
          controllerSnapshot: message.meta?.controllerSnapshot ?? null,
          turnPlan: message.meta?.turnPlan ?? null,
          contextSnapshot: message.meta?.contextSnapshot ?? null,
        })),
      messages,
      feedback: feedbackEvents,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `plot-lab-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [controllerState, documentId, feedbackEvents, messages, plotLabDecisionsTab]);

  const submitComposer = useCallback(() => {
    const value = input.trim();
    if (!value || isStreaming) return;

    if (isCapturingContext) {
      void sendToLevi({
        displayText: value,
        promptText: [
          "The writer is adding context before Levi continues.",
          "Absorb this context, then continue with the next character-first step.",
          "Do not treat this as a story choice unless the context clearly says so.",
          `Context:\n${value}`,
        ].join("\n\n"),
      });
      return;
    }

    void sendToLevi();
  }, [input, isCapturingContext, isStreaming, sendToLevi]);

  const canUseTestingTools = isAdmin || canUseTesterTools;

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-border bg-background"
      style={{ width }}
    >
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize hover:bg-indigo-200/70 active:bg-indigo-300"
      />
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">Levi</h2>
        </div>
        <div className="flex items-center gap-1">
          {canUseTestingTools ? (
            <>
              <button
                type="button"
                onClick={exportDebugJson}
                aria-label="Export Plot Lab debug JSON"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Plot Lab"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="border-b border-border bg-muted/20 px-4 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">Locks save to</span>
          <span className="truncate text-muted-foreground">{plotLabDecisionsTab?.title ?? "Plot Lab Decisions tab missing"}</span>
        </div>
        {lockSaveMessage ? (
          <div className={lockSaveStatus === "error" ? "mt-1 text-red-600" : "mt-1 text-emerald-700"}>
            {lockSaveMessage}
          </div>
        ) : null}
      </section>

      {canUseTestingTools ? (
        <section className="border-b border-border bg-muted/10 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startOver}
              disabled={!plotLabDecisionsTab || isStreaming || lockSaveStatus === "saving"}
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={() => {
                void clearPlotLabDecisions();
              }}
              disabled={!plotLabDecisionsTab || isStreaming || lockSaveStatus === "saving"}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-red-900/60 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear decisions
            </button>
          </div>
        </section>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="max-w-[26ch] text-sm leading-6 text-muted-foreground">
              Chat with Levi to shape the plot.
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const isLatest = index === messages.length - 1;
            const displayContent = message.content;
            const visibleActions = isLatest && message.role === "assistant"
              ? [
                  ...(message.meta?.structuredActions ?? []),
                  ...controllerState.turnPlan.actions,
                ]
              : [];
            const dedupedVisibleActions = visibleActions.filter((action, actionIndex, actions) =>
              actions.findIndex((candidate) => candidate.actionId === action.actionId) === actionIndex
            );
            const showActions = dedupedVisibleActions.length > 0 && isLatest && !isStreaming;
            const isUser = message.role === "user";
            const isLatestAssistant = !isUser && isLatest;
            return (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div className={`${isUser ? "max-w-[82%]" : "max-w-[94%]"} space-y-2`}>
                  {displayContent && (
                    <div
                      className={`rounded-lg whitespace-pre-wrap ${
                        isUser
                          ? "bg-indigo-600 px-3 py-2 text-[13px] leading-5 text-white"
                          : `border px-3.5 py-3 text-[15px] leading-7 text-foreground shadow-sm ${
                              isLatestAssistant
                                ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-500/30 dark:bg-indigo-950/20"
                                : "border-border bg-card"
                            }`
                      }`}
                    >
                      {displayContent}
                    </div>
                  )}
                  {showActions && (
                    <div className="flex w-full min-w-0 flex-col gap-1.5">
                      {dedupedVisibleActions.map((action) => (
                        <button
                          key={action.actionId}
                          type="button"
                          onClick={() => handleAction(action, displayContent, message.meta)}
                          title={action.detail ? `${action.label}: ${action.detail}` : action.label}
                          aria-label={action.detail ? `${action.label}: ${action.detail}` : action.label}
                          className="flex min-h-11 w-full min-w-0 items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-indigo-300 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block whitespace-normal break-words text-foreground [overflow-wrap:anywhere]">{action.label}</span>
                            {action.detail ? (
                              <span className="block whitespace-normal break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{action.detail}</span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!isUser && canUseTestingTools ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => recordFeedback(index, "up", displayContent)}
                        aria-label="Mark this Levi response as good"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => recordFeedback(index, "down", displayContent)}
                        aria-label="Mark this Levi response as bad"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {feedbackEvents.some((event) => event.messageIndex === index) ? (
                        <span className="text-[11px] text-muted-foreground">logged</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}

        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-lg border border-border bg-card px-3 py-2 text-sm leading-6 text-foreground">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {getThinkingText(messages)}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <footer className="border-t border-border p-3">
        <div className="rounded-lg border border-border bg-card">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (handleTextareaLineMoveKeyDown(event)) return;
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitComposer();
              }
            }}
            disabled={isStreaming}
            rows={3}
            placeholder={isCapturingContext ? "Add the missing context for Levi..." : "Chat with Levi..."}
            className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-3 border-t border-border px-2 py-2">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {isCapturingContext ? "Context will be sent only after you type and press Send." : ""}
            </p>
            <button
              type="button"
              onClick={submitComposer}
              disabled={isStreaming || !input.trim()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Send
            </button>
          </div>
        </div>
      </footer>
    </aside>
  );
}
