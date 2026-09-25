"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import { splitTabByH3, tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { clientTrace } from "@/lib/clientTrace";
import { handleTextareaLineMoveKeyDown } from "@/lib/editing/line-move";

type LabMode =
  | "predef_lab_beats"
  | "predef_lab_dialogue_design"
  | "predef_lab_draft"
  | "predef_lab_iterate"
  | "predef_lab_dialogue_pass";
type LabStage = "inputs" | "beats" | "dialogue" | "draft";
type TurnStage = "beats" | "dialogue" | "draft";
type TurnStatus = "running" | "complete" | "failed";
type AutoPipelineStep = "idle" | "beats" | "dialogue" | "draft" | "complete" | "failed";

interface SectionOption {
  id: string;
  title: string;
  content: string;
  episodeNumber: number | null;
}

interface LabTurn {
  id: string;
  stage: TurnStage;
  userInstruction: string;
  agentTitle: string;
  mode: LabMode;
  output: string;
  status: TurnStatus;
  version: number;
  error?: string;
  createdAt: number;
}

interface FinalizedArtifacts {
  beats?: {
    output: string;
    version: number;
    finalizedAt: number;
  };
  dialogue?: {
    output: string;
    version: number;
    finalizedAt: number;
  };
}

interface ConfirmDialogState {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

interface PredefinedLabStageWorkspaceProps {
  tabs: TabRow[];
  documentId: string;
  modelId: string;
  thinking: boolean;
  onRefreshTabs?: () => Promise<TabRow[]>;
}

function episodeNumberFromTitle(title: string): number | null {
  const match = title.match(/\b(?:episode|ep)\s*#?\s*(\d+)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function cleanHeading(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function shortHeading(title: string, maxLength = 10): string {
  const clean = cleanHeading(title);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trim()}...`;
}

function getTaggedForTab(tabs: TabRow[], type: TabRow["type"]): string {
  const tab = tabs.find((t) => t.type === type);
  return tiptapJsonToTagged(tab?.content ?? null);
}

function getSections(tabs: TabRow[], type: TabRow["type"]): SectionOption[] {
  const tagged = getTaggedForTab(tabs, type);
  return splitTabByH3(tagged)
    .filter((section) => cleanHeading(section.title).length > 0)
    .map((section) => ({
      id: `${type}-${section.index}`,
      title: section.title,
      content: section.content,
      episodeNumber: episodeNumberFromTitle(section.title),
    }));
}

function compactLabel(option: SectionOption): string {
  return option.episodeNumber ? `Ep${option.episodeNumber}` : shortHeading(option.title);
}

function hasBodyContent(tagged: string): boolean {
  return tagged.split("\n").some((line) => /^\[(P|UL|OL)\]/.test(line));
}

function latestCompleteTurn(turns: LabTurn[], stage: TurnStage): LabTurn | null {
  const complete = turns.filter((turn) => turn.stage === stage && turn.status === "complete");
  return complete.length > 0 ? complete[complete.length - 1] : null;
}

function countDialogueLines(text: string): number {
  return text
    .split("\n")
    .filter((line) => /^\s*[A-Z][A-Z0-9 .'-]*(?:\s*\(V\.?O\.?\))?\s*:/.test(line))
    .length;
}

function buildContext({
  mode,
  selectedPlot,
  selectedPredefs,
  originalInstruction,
  turnInstruction,
  beatPlan,
  dialogueDesign,
  draft,
}: {
  mode: LabMode;
  selectedPlot: SectionOption;
  selectedPredefs: SectionOption[];
  originalInstruction: string;
  turnInstruction: string;
  beatPlan: string;
  dialogueDesign: string;
  draft: string;
}): string {
  if (mode === "predef_lab_dialogue_design") {
    return `## Original Writer Instruction
${originalInstruction.trim() || "(none)"}

## Current Turn Instruction
${turnInstruction.trim() || "(none)"}

## Approved / Current Key Beats
${beatPlan.trim() || "(none yet)"}

## Selected Previous Predefined Episodes
${selectedPredefs.length > 0 ? selectedPredefs.map((s) => s.content).join("\n\n") : "(none selected)"}

## Approved / Current Dialogue Design
${dialogueDesign.trim() || "(none yet)"}

## Important Context Rule
The Characters tab and Target Plot are intentionally excluded. Use finalized beats for episode shape and selected previous predefined episodes for voice, continuity, and knowledge state.`;
  }

  return `## Original Writer Instruction
${originalInstruction.trim() || "(none)"}

## Current Turn Instruction
${turnInstruction.trim() || "(none)"}

## Target Plot
${selectedPlot.content}

## Selected Previous Predefined Episodes
${selectedPredefs.length > 0 ? selectedPredefs.map((s) => s.content).join("\n\n") : "(none selected)"}

## Approved / Current Key Beats
${beatPlan.trim() || "(none yet)"}

## Approved / Current Dialogue Design
${dialogueDesign.trim() || "(none yet)"}

## Current Draft
${draft.trim() || "(none yet)"}

## Important Context Rule
The Characters tab is intentionally excluded. Use selected previous predefined episodes for voice, continuity, and knowledge state.`;
}

export default function PredefinedLabStageWorkspace({
  tabs,
  documentId,
  modelId,
  thinking,
  onRefreshTabs,
}: PredefinedLabStageWorkspaceProps) {
  const plotOptions = useMemo(() => getSections(tabs, "microdrama_plots"), [tabs]);
  const predefOptions = useMemo(() => getSections(tabs, "predefined_episodes"), [tabs]);
  const predefTagged = useMemo(() => getTaggedForTab(tabs, "predefined_episodes"), [tabs]);

  const [selectedPlotId, setSelectedPlotId] = useState("");
  const [selectedPredefIds, setSelectedPredefIds] = useState<string[]>([]);
  const [predefManuallyChanged, setPredefManuallyChanged] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [autoRunToDraft, setAutoRunToDraft] = useState(false);
  const [autoPipelineStep, setAutoPipelineStep] = useState<AutoPipelineStep>("idle");
  const [autoPipelineStartedAt, setAutoPipelineStartedAt] = useState<number | null>(null);
  const [composerText, setComposerText] = useState("");
  const [stage, setStage] = useState<LabStage>("inputs");
  const [turns, setTurns] = useState<LabTurn[]>([]);
  const [finalized, setFinalized] = useState<FinalizedArtifacts>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [runningLabel, setRunningLabel] = useState("");
  const [loadingDotCount, setLoadingDotCount] = useState(1);
  const [copyTarget, setCopyTarget] = useState<string | null>(null);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [predefPickerOpen, setPredefPickerOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const predefPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedPlotId || plotOptions.length === 0 || predefOptions.length === 0) return;
    const latestPredefEpisode = Math.max(
      ...predefOptions
        .map((episode) => episode.episodeNumber)
        .filter((episodeNumber): episodeNumber is number => episodeNumber != null)
    );
    if (!Number.isFinite(latestPredefEpisode)) return;
    const nextPlot = plotOptions.find((plot) => plot.episodeNumber === latestPredefEpisode + 1);
    if (nextPlot) setSelectedPlotId(nextPlot.id);
  }, [plotOptions, predefOptions, selectedPlotId]);

  useEffect(() => {
    setPredefManuallyChanged(false);
  }, [selectedPlotId]);

  useEffect(() => {
    if (predefManuallyChanged) return;
    const activePlot = plotOptions.find((plot) => plot.id === selectedPlotId);
    if (!activePlot?.episodeNumber) {
      setSelectedPredefIds([]);
      return;
    }
    setSelectedPredefIds(
      predefOptions
        .filter((episode) => episode.episodeNumber != null && episode.episodeNumber < activePlot.episodeNumber!)
        .map((episode) => episode.id)
    );
  }, [plotOptions, predefManuallyChanged, predefOptions, selectedPlotId]);

  useEffect(() => {
    if (!selectedPlotId) return;
    if (!plotOptions.find((plot) => plot.id === selectedPlotId)) {
      setSelectedPlotId("");
    }
  }, [plotOptions, selectedPlotId]);

  useEffect(() => {
    if (!predefPickerOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPredefPickerOpen(false);
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !predefPickerRef.current?.contains(target)) {
        setPredefPickerOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [predefPickerOpen]);

  const selectedPlot = plotOptions.find((p) => p.id === selectedPlotId) ?? null;
  const latestBeat = latestCompleteTurn(turns, "beats");
  const latestDialogue = latestCompleteTurn(turns, "dialogue");
  const latestDraft = latestCompleteTurn(turns, "draft");
  const visibleTurns = turns.filter((turn) => turn.stage === stage);
  const existingPredefForPlot =
    selectedPlot?.episodeNumber != null
      ? predefOptions.find((p) => p.episodeNumber === selectedPlot.episodeNumber) ?? null
      : null;
  const predefSummary =
    predefOptions.length === 0
      ? "None available"
      : selectedPredefIds.length === predefOptions.length
        ? "All"
        : selectedPredefIds.length === 0
          ? "None selected"
          : "Selected episodes";
  const missingPredefHeadings = predefOptions.length === 0 && hasBodyContent(predefTagged);

  function nextVersion(turnStage: TurnStage) {
    return turns.filter((turn) => turn.stage === turnStage && turn.status === "complete").length + 1;
  }

  useEffect(() => {
    if (!copyTarget) return;
    const timeout = window.setTimeout(() => setCopyTarget(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copyTarget]);

  useEffect(() => {
    if (!isStreaming) {
      setLoadingDotCount(1);
      return;
    }
    const interval = window.setInterval(() => {
      setLoadingDotCount((count) => (count >= 3 ? 1 : count + 1));
    }, 450);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  async function copyText(text: string, target: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyTarget(target);
    } catch {
      setCopyTarget(null);
    }
  }

  async function resolveFreshSelection() {
    const freshTabs = onRefreshTabs ? await onRefreshTabs() : tabs;
    const freshPlotOptions = getSections(freshTabs.length > 0 ? freshTabs : tabs, "microdrama_plots");
    const freshPredefOptions = getSections(freshTabs.length > 0 ? freshTabs : tabs, "predefined_episodes");
    return {
      activeSelectedPlot:
        freshPlotOptions.find((p) => p.id === selectedPlotId) ?? selectedPlot,
      activeSelectedPredefs: freshPredefOptions.filter((p) => selectedPredefIds.includes(p.id)),
      activePredefOptions: freshPredefOptions,
    };
  }

  async function runTurn({
    turnStage,
    mode,
    userInstruction,
    retryTurnId,
    beatPlanOverride,
    dialogueDesignOverride,
    visibleStage,
    skipInputWarnings = false,
  }: {
    turnStage: TurnStage;
    mode: LabMode;
    userInstruction: string;
    retryTurnId?: string;
    beatPlanOverride?: string;
    dialogueDesignOverride?: string;
    visibleStage?: LabStage;
    skipInputWarnings?: boolean;
  }): Promise<LabTurn | null> {
    if (isStreaming) return null;
    const { activeSelectedPlot, activeSelectedPredefs, activePredefOptions } =
      await resolveFreshSelection();
    if (!activeSelectedPlot) return null;

    if (turnStage === "beats" && stage === "inputs" && !skipInputWarnings) {
      const activeExistingPredefForPlot =
        activeSelectedPlot.episodeNumber != null
          ? activePredefOptions.find((p) => p.episodeNumber === activeSelectedPlot.episodeNumber) ?? null
          : null;
      if (activeExistingPredefForPlot) {
        setConfirmDialog({
          title: "Predefined already exists",
          body: `${cleanHeading(activeSelectedPlot.title)} already appears to have a predefined episode (${cleanHeading(activeExistingPredefForPlot.title)}). Continue anyway?`,
          confirmLabel: "Continue",
          onConfirm: () => {
            setConfirmDialog(null);
            void runTurn({
              turnStage,
              mode,
              userInstruction,
              retryTurnId,
              beatPlanOverride,
              dialogueDesignOverride,
              visibleStage,
              skipInputWarnings: true,
            });
          },
        });
        return null;
      }
    }

    const priorBeatPlan = beatPlanOverride ?? finalized.beats?.output ?? latestBeat?.output ?? "";
    const priorDialogueDesign =
      dialogueDesignOverride ?? finalized.dialogue?.output ?? latestDialogue?.output ?? "";
    const priorDraft = latestDraft?.output ?? "";
    const context = buildContext({
      mode,
      selectedPlot: activeSelectedPlot,
      selectedPredefs: activeSelectedPredefs,
      originalInstruction: instruction,
      turnInstruction: userInstruction,
      beatPlan: priorBeatPlan,
      dialogueDesign: priorDialogueDesign,
      draft: priorDraft,
    });
    clientTrace("predefined_lab.request", {
      documentId,
      mode,
      turnStage,
      plotTitle: cleanHeading(activeSelectedPlot.title),
      plotEpisodeNumber: activeSelectedPlot.episodeNumber,
      plotChars: activeSelectedPlot.content.length,
      selectedPredefs: activeSelectedPredefs.map((episode) => ({
        title: cleanHeading(episode.title),
        episodeNumber: episode.episodeNumber,
        chars: episode.content.length,
      })),
      originalInstructionChars: instruction.trim().length,
      turnInstructionChars: userInstruction.trim().length,
      beatPlanChars: priorBeatPlan.length,
      dialogueDesignChars: priorDialogueDesign.length,
      draftChars: priorDraft.length,
      draftDialogueLines: countDialogueLines(priorDraft),
    });
    const agentTitle =
      turnStage === "beats"
        ? "Beat Builder"
        : turnStage === "dialogue"
        ? "Dialogue Designer"
        : mode === "predef_lab_dialogue_pass"
          ? "Dialogue Pass"
          : mode === "predef_lab_iterate"
          ? "Draft Reviser"
          : "Episode Writer";
    const turnId = retryTurnId ?? `${Date.now()}-${turnStage}`;

    setStage(visibleStage ?? turnStage);
    setIsStreaming(true);
    setRunningLabel(agentTitle);
    setCopyTarget(null);

    if (retryTurnId) {
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === retryTurnId
            ? { ...turn, status: "running", output: "", error: undefined }
            : turn
        )
      );
    } else {
      const nextTurn: LabTurn = {
        id: turnId,
        stage: turnStage,
        userInstruction,
        agentTitle,
        mode,
        output: "",
        status: "running",
        version: nextVersion(turnStage),
        createdAt: Date.now(),
      };
      setTurns((prev) => [...prev, nextTurn]);
    }

    try {
      const res = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          documentId,
          modelId,
          thinking,
          messages: [{ role: "user", content: context }],
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Predefined Lab request failed");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setTurns((prev) =>
          prev.map((turn) => (turn.id === turnId ? { ...turn, output: accumulated } : turn))
        );
      }

      if (!accumulated.trim()) {
        throw new Error("No output returned from the model.");
      }

      const originalTurn = retryTurnId ? turns.find((turn) => turn.id === retryTurnId) : null;
      const completedTurn: LabTurn = {
        id: turnId,
        stage: turnStage,
        userInstruction,
        agentTitle,
        mode,
        output: accumulated,
        status: "complete",
        version: originalTurn?.version ?? nextVersion(turnStage),
        createdAt: originalTurn?.createdAt ?? Date.now(),
      };
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId ? { ...turn, status: "complete", output: accumulated } : turn
        )
      );
      clientTrace("predefined_lab.response", {
        documentId,
        mode,
        turnStage,
        outputChars: accumulated.length,
        dialogueLines: countDialogueLines(accumulated),
        beforeDialogueLines: countDialogueLines(priorDraft),
        leakedImportTags: /^\s*\[(H\d|P|UL|OL)\]/m.test(accumulated),
        hasCommentary: /\b(rationale|analysis|knowledge audit|here is|here's)\b/i.test(accumulated),
      });
      if (mode === "predef_lab_draft" && turnStage === "draft" && !priorDraft.trim() && !retryTurnId) {
        clientTrace("predefined_lab.first_draft_text", {
          documentId,
          modelId,
          thinking,
          outputChars: accumulated.length,
          dialogueLines: countDialogueLines(accumulated),
          text: accumulated,
        });
      }
      return completedTurn;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Predefined Lab failed";
      clientTrace("predefined_lab.failed", {
        documentId,
        mode,
        turnStage,
        message,
      });
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId ? { ...turn, status: "failed", error: message } : turn
        )
      );
      const originalTurn = retryTurnId ? turns.find((turn) => turn.id === retryTurnId) : null;
      return {
        id: turnId,
        stage: turnStage,
        userInstruction,
        agentTitle,
        mode,
        output: "",
        status: "failed",
        version: originalTurn?.version ?? nextVersion(turnStage),
        error: message,
        createdAt: originalTurn?.createdAt ?? Date.now(),
      };
    } finally {
      setIsStreaming(false);
      setRunningLabel("");
    }
  }

  async function buildInitialBeats() {
    if (autoRunToDraft) {
      await runAutoPipeline();
      return;
    }
    await runTurn({
      turnStage: "beats",
      mode: "predef_lab_beats",
      userInstruction: instruction || "Build key beats from the selected context.",
    });
  }

  async function runAutoPipeline() {
    const startedAt = Date.now();
    setAutoPipelineStartedAt(startedAt);
    setAutoPipelineStep("beats");
    setStage("draft");
    setComposerText("");
    const beat = await runTurn({
      turnStage: "beats",
      mode: "predef_lab_beats",
      userInstruction: instruction || "Build key beats from the selected context.",
      visibleStage: "draft",
      skipInputWarnings: true,
    });
    if (!beat || beat.status !== "complete") {
      setAutoPipelineStep("failed");
      setStage("beats");
      return;
    }

    const finalizedBeat = {
      output: beat.output,
      version: beat.version,
      finalizedAt: Date.now(),
    };
    setFinalized({ beats: finalizedBeat });

    setAutoPipelineStep("dialogue");
    const dialogue = await runTurn({
      turnStage: "dialogue",
      mode: "predef_lab_dialogue_design",
      userInstruction: "Build dialogue design from finalized key beats.",
      beatPlanOverride: finalizedBeat.output,
      visibleStage: "draft",
      skipInputWarnings: true,
    });
    if (!dialogue || dialogue.status !== "complete") {
      setAutoPipelineStep("failed");
      setStage("dialogue");
      return;
    }

    const finalizedDialogue = {
      output: dialogue.output,
      version: dialogue.version,
      finalizedAt: Date.now(),
    };
    setFinalized({ beats: finalizedBeat, dialogue: finalizedDialogue });

    setAutoPipelineStep("draft");
    const draft = await runTurn({
      turnStage: "draft",
      mode: "predef_lab_draft",
      userInstruction: "Write episode draft from finalized key beats and approved dialogue design.",
      beatPlanOverride: finalizedBeat.output,
      dialogueDesignOverride: finalizedDialogue.output,
      visibleStage: "draft",
      skipInputWarnings: true,
    });
    setAutoPipelineStep(draft?.status === "complete" ? "complete" : "failed");
  }

  async function sendComposer() {
    const text = composerText.trim();
    if (isStreaming) return;
    const firstDialogue = stage === "dialogue" && !latestDialogue && finalized.beats;
    const firstDraft = stage === "draft" && !latestDraft && finalized.beats && finalized.dialogue;
    if (!text && !firstDialogue && !firstDraft) return;
    setComposerText("");
    await runTurn({
      turnStage: stage === "draft" ? "draft" : stage === "dialogue" ? "dialogue" : "beats",
      mode:
        stage === "draft"
          ? firstDraft
            ? "predef_lab_draft"
            : "predef_lab_iterate"
          : stage === "dialogue"
            ? "predef_lab_dialogue_design"
            : "predef_lab_beats",
      userInstruction:
        text ||
        (stage === "dialogue"
          ? "Build dialogue design from finalized key beats."
          : "Write episode draft from finalized key beats and approved dialogue design."),
    });
  }

  async function retryTurn(turn: LabTurn) {
    await runTurn({
      turnStage: turn.stage,
      mode: turn.mode,
      userInstruction: turn.userInstruction,
      retryTurnId: turn.id,
    });
  }

  async function rerunTurn(turn: LabTurn) {
    if (isStreaming) return;
    const feedback = composerText.trim();
    setComposerText("");
    await runTurn({
      turnStage: turn.stage,
      mode: turn.mode,
      userInstruction: feedback || `Rerun ${turn.agentTitle} from the latest saved output and current context.`,
    });
  }

  function startEditTurn(turn: LabTurn) {
    setEditingTurnId(turn.id);
    setEditingText(turn.output);
  }

  function cancelEditTurn() {
    setEditingTurnId(null);
    setEditingText("");
  }

  function saveEditedTurn(turn: LabTurn) {
    const output = editingText;
    setTurns((prev) =>
      prev.map((item) => (item.id === turn.id ? { ...item, output } : item))
    );
    setFinalized((prev) => {
      if (turn.stage === "beats" && prev.beats?.version === turn.version) {
        return { ...prev, beats: { ...prev.beats, output } };
      }
      if (turn.stage === "dialogue" && prev.dialogue?.version === turn.version) {
        return { ...prev, dialogue: { ...prev.dialogue, output } };
      }
      return prev;
    });
    cancelEditTurn();
  }

  async function generateDialogueFromFinalizedBeats() {
    if (!latestBeat || isStreaming) return;
    const finalizedBeat = {
      output: latestBeat.output,
      version: latestBeat.version,
      finalizedAt: Date.now(),
    };
    setFinalized((prev) => ({ ...prev, beats: finalizedBeat }));
    setStage("dialogue");
    await runTurn({
      turnStage: "dialogue",
      mode: "predef_lab_dialogue_design",
      userInstruction: "Build dialogue design from finalized key beats.",
      beatPlanOverride: finalizedBeat.output,
    });
  }

  async function generateDraftFromApprovedDialogue() {
    if (!latestDialogue || !finalized.beats || isStreaming) return;
    const finalizedDialogue = {
      output: latestDialogue.output,
      version: latestDialogue.version,
      finalizedAt: Date.now(),
    };
    setFinalized((prev) => ({ ...prev, dialogue: finalizedDialogue }));
    setStage("draft");
    setComposerText("");
    await runTurn({
      turnStage: "draft",
      mode: "predef_lab_draft",
      userInstruction: "Write episode draft from finalized key beats and approved dialogue design.",
      dialogueDesignOverride: finalizedDialogue.output,
    });
  }

  function editInputs() {
    if (turns.length > 0) {
      setConfirmDialog({
        title: "Edit inputs?",
        body: "This clears the current Lab run and returns to input selection.",
        confirmLabel: "Edit inputs",
        onConfirm: () => {
          setConfirmDialog(null);
          setStage("inputs");
          setTurns([]);
          setFinalized({});
          setComposerText("");
          setEditingTurnId(null);
          setEditingText("");
          setCopyTarget(null);
          setAutoRunToDraft(false);
          setAutoPipelineStep("idle");
          setAutoPipelineStartedAt(null);
        },
      });
      return;
    }
    setStage("inputs");
    setTurns([]);
    setFinalized({});
    setComposerText("");
    setEditingTurnId(null);
    setEditingText("");
    setCopyTarget(null);
    setAutoRunToDraft(false);
    setAutoPipelineStep("idle");
    setAutoPipelineStartedAt(null);
  }

  function nextRun() {
    setConfirmDialog({
      title: "Move to next episode?",
      body: "This closes the current Lab run. Copy anything you want to keep before moving on.",
      confirmLabel: "Next episode",
      onConfirm: () => {
        setConfirmDialog(null);
        setStage("inputs");
        setSelectedPlotId("");
        setSelectedPredefIds([]);
        setPredefManuallyChanged(false);
        setInstruction("");
        setTurns([]);
        setFinalized({});
        setComposerText("");
        setEditingTurnId(null);
        setEditingText("");
        setCopyTarget(null);
        setAutoRunToDraft(false);
        setAutoPipelineStep("idle");
        setAutoPipelineStartedAt(null);
      },
    });
  }

  function renderTurnBadge(turn: LabTurn) {
    if (turn.status === "running") return "RUNNING";
    if (turn.status === "failed") return "FAILED";
    const latest = latestCompleteTurn(turns, turn.stage);
    return latest?.id === turn.id ? `LATEST v${turn.version}` : `OLD v${turn.version}`;
  }

  function copyButtonClass(target: string, extra = "") {
    const copied = copyTarget === target;
    return `${extra} ${
      copied
        ? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700"
        : "border-border text-muted-foreground hover:bg-muted"
    }`;
  }

  function animatedWaitingText(label = "Generating") {
    return `${label}${".".repeat(loadingDotCount)}`;
  }

  function renderInputs() {
    return (
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-foreground">Select Microdrama Plot</span>
            <select
              value={selectedPlotId}
              onChange={(e) => setSelectedPlotId(e.target.value)}
              disabled={isStreaming}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select...</option>
              {plotOptions.map((plot) => (
                <option key={plot.id} value={plot.id}>
                  {shortHeading(plot.title)}
                </option>
              ))}
            </select>
          </label>

          {selectedPlot && existingPredefForPlot && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {compactLabel(selectedPlot)} already has a predefined episode. You can continue, but this may overwrite the same episode intent.
            </div>
          )}

          <div ref={predefPickerRef}>
            <label className="block">
              <span className="text-sm font-medium text-foreground">Previous predefined episodes to send</span>
              <button
                type="button"
                disabled={isStreaming || predefOptions.length === 0}
                aria-expanded={predefPickerOpen}
                onClick={() => setPredefPickerOpen((open) => !open)}
                className="mt-1 flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>{predefSummary}</span>
                <span className="text-xs text-muted-foreground">
                  {selectedPredefIds.length}/{predefOptions.length}
                </span>
              </button>
            </label>
            {predefPickerOpen && (
              <div className="mt-2 rounded-md border border-border bg-background p-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {selectedPredefIds.length}/{predefOptions.length} selected
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPredefManuallyChanged(true);
                        setSelectedPredefIds(predefOptions.map((episode) => episode.id));
                      }}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPredefManuallyChanged(true);
                        setSelectedPredefIds([]);
                      }}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      None
                    </button>
                    <button
                      type="button"
                      onClick={() => setPredefPickerOpen(false)}
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {predefOptions.map((episode) => {
                    const active = selectedPredefIds.includes(episode.id);
                    return (
                      <label
                        key={episode.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
                        title={cleanHeading(episode.title)}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={isStreaming}
                          onChange={() => {
                            setPredefManuallyChanged(true);
                            setSelectedPredefIds((prev) =>
                              active ? prev.filter((id) => id !== episode.id) : [...prev, episode.id]
                            );
                          }}
                          className="h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="min-w-0 truncate">{compactLabel(episode)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-end border-t border-border pt-2">
                  <button
                    type="button"
                    onClick={() => setPredefPickerOpen(false)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {missingPredefHeadings && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Predefined Episodes has content but no H3 episode headings, so previous episode context cannot be selected.
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-foreground">Instruction</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={handleTextareaLineMoveKeyDown}
              disabled={isStreaming}
              placeholder="Example: Keep blocking simple. Make Taiga panic comic. Sakura should not know Taiga yet."
              className="mt-1 h-28 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <label className="flex min-w-[220px] items-start gap-3">
            <input
              type="checkbox"
              checked={autoRunToDraft}
              onChange={(event) => setAutoRunToDraft(event.target.checked)}
              disabled={isStreaming}
              className="mt-1 h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Auto-run to Draft</span>
              <span className="block text-xs leading-relaxed text-muted-foreground">
                Runs key beats, dialogue, and draft without stopping for review.
              </span>
            </span>
          </label>
          <button
            type="button"
            disabled={!selectedPlot || isStreaming}
            onClick={buildInitialBeats}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming
              ? `Running ${runningLabel || "Pipeline"}...`
              : autoRunToDraft
                ? "Generate Draft"
                : "Build Key Beats"}
          </button>
        </div>
      </section>
    );
  }

  function renderContextBar() {
    return (
      <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-foreground">
              {stage === "draft" || stage === "dialogue" ? "Finalized Context" : "Context"}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              Plot: {selectedPlot ? shortHeading(selectedPlot.title, 24) : "None"}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              Previous predefined: {predefSummary}
            </span>
            {(stage === "draft" || stage === "dialogue") && finalized.beats && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                Key Beats: Finalized v{finalized.beats.version}
              </span>
            )}
            {stage === "draft" && finalized.dialogue && (
              <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                Dialogue: Approved v{finalized.dialogue.version}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={isStreaming}
            onClick={editInputs}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Edit inputs
          </button>
        </div>
      </section>
    );
  }

  function renderTimeline() {
    if (visibleTurns.length === 0) {
      return (
        <section className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          {stage === "draft"
            ? autoPipelineStep === "complete"
              ? "First draft generated from auto-run. Review it below, or add a change request and rerun."
              : autoPipelineStartedAt
                ? "Auto-run is building your first draft. The generated draft will appear here."
                : "Add an instruction below, or generate the episode draft from the approved pipeline context."
            : stage === "dialogue"
              ? "Key beats are finalized. Build a dialogue design, then approve it for episode drafting."
              : "Key beat generation will appear here."}
        </section>
      );
    }

    return (
      <section className="space-y-4">
        {visibleTurns.map((turn) => {
          const latestForStage = latestCompleteTurn(turns, turn.stage);
          const isLatestTurn = latestForStage?.id === turn.id;
          const isEditing = editingTurnId === turn.id;
          const visibleOutput = isEditing ? editingText : turn.output;
          return (
          <div key={turn.id} className="space-y-3">
            <article className="rounded-lg border border-border bg-muted p-4">
              <h2 className="mb-2 text-sm font-semibold text-foreground">User</h2>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                {turn.userInstruction}
              </pre>
            </article>

            <article
              className={`rounded-lg border p-4 ${
                turn.status === "failed"
                  ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                  : "border-emerald-200 bg-card dark:border-emerald-900"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{turn.agentTitle}</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      turn.status === "failed"
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
                        : turn.status === "running"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200"
                          : latestCompleteTurn(turns, turn.stage)?.id === turn.id
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                            : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {renderTurnBadge(turn)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {turn.status === "complete" && (
                    <>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={isStreaming}
                            onClick={() => saveEditedTurn(turn)}
                            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={isStreaming}
                            onClick={cancelEditTurn}
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isStreaming}
                          onClick={() => startEditTurn(turn)}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          Edit
                        </button>
                      )}
                      {isLatestTurn && !isEditing && (
                        <button
                          type="button"
                          disabled={isStreaming}
                          onClick={() => void rerunTurn(turn)}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          Rerun
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => copyText(visibleOutput, `${turn.id}-top`)}
                        className={copyButtonClass(
                          `${turn.id}-top`,
                          "rounded-md border px-2 py-1 text-xs transition-colors"
                        )}
                      >
                        {copyTarget === `${turn.id}-top` ? "Copied" : "Copy"}
                      </button>
                    </>
                  )}
                  {turn.status === "failed" && (
                    <button
                      type="button"
                      disabled={isStreaming}
                      onClick={() => retryTurn(turn)}
                      className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
              {isEditing ? (
                <textarea
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  onKeyDown={handleTextareaLineMoveKeyDown}
                  className="min-h-72 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-sans text-sm leading-relaxed text-foreground focus:border-emerald-500 focus:outline-none"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                  {turn.status === "failed"
                    ? `Failed: ${turn.error ?? "Predefined Lab failed"}`
                    : turn.output || animatedWaitingText()}
                </pre>
              )}
              {turn.status === "complete" && (
                <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        disabled={isStreaming}
                        onClick={cancelEditTurn}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isStreaming}
                        onClick={() => saveEditedTurn(turn)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </>
                  ) : isLatestTurn ? (
                    <button
                      type="button"
                      disabled={isStreaming}
                      onClick={() => void rerunTurn(turn)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Rerun
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => copyText(visibleOutput, `${turn.id}-bottom`)}
                    className={copyButtonClass(
                      `${turn.id}-bottom`,
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                    )}
                  >
                    {copyTarget === `${turn.id}-bottom` ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </article>
          </div>
          );
        })}
      </section>
    );
  }

  function renderAutoPipelineProgress() {
    if (!autoPipelineStartedAt || autoPipelineStep === "idle") return null;

    const statusCopy: Record<AutoPipelineStep, { title: string; detail: string }> = {
      idle: { title: "", detail: "" },
      beats: {
        title: animatedWaitingText("Building key beats"),
        detail: "Auto-run is working in the background.",
      },
      dialogue: {
        title: animatedWaitingText("Designing dialogue"),
        detail: "Key beats are done. Dialogue design is running now.",
      },
      draft: {
        title: animatedWaitingText("Writing first draft"),
        detail: "Dialogue design is done. The episode draft is being generated.",
      },
      complete: {
        title: "First draft ready.",
        detail: "Auto-run completed. Review the draft below.",
      },
      failed: {
        title: "Auto-run stopped.",
        detail: "A pipeline step failed. Review the visible stage and rerun that step.",
      },
    };
    const copy = statusCopy[autoPipelineStep];
    const isFailed = autoPipelineStep === "failed";
    const isComplete = autoPipelineStep === "complete";

    return (
      <section
        className={`rounded-md border px-4 py-3 shadow-sm ${
          isFailed
            ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-100"
            : isComplete
              ? "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100"
              : "border-cyan-200 bg-cyan-50/70 text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100"
        }`}
      >
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="mt-1 text-xs opacity-80">{copy.detail}</p>
      </section>
    );
  }

  function renderPipelineSummary() {
    if (stage !== "draft") return null;
    const pipelineTurns = turns.filter(
      (turn) => turn.stage !== "draft" && turn.status === "complete"
    );
    if (pipelineTurns.length === 0) return null;

    return (
      <details className="rounded-lg border border-border bg-card shadow-sm">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">
          Pipeline
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3">
          {pipelineTurns.map((turn) => (
            <section key={`pipeline-${turn.id}`} className="rounded-md border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {turn.agentTitle} v{turn.version}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(turn.output, `${turn.id}-pipeline`)}
                  className={copyButtonClass(
                    `${turn.id}-pipeline`,
                    "rounded-md border px-2 py-1 text-xs transition-colors"
                  )}
                >
                  {copyTarget === `${turn.id}-pipeline` ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                {turn.output}
              </pre>
            </section>
          ))}
        </div>
      </details>
    );
  }

  function renderComposer() {
    const isDraftStage = stage === "draft";
    const isDialogueStage = stage === "dialogue";
    const isFirstDialogue = isDialogueStage && !latestDialogue && finalized.beats;
    const isFirstDraft = isDraftStage && !latestDraft && finalized.beats && finalized.dialogue;
    const canSend = !isStreaming && (composerText.trim().length > 0 || Boolean(isFirstDialogue) || Boolean(isFirstDraft));
    const composerLabel = isDraftStage
      ? latestDraft
        ? "What should change in the episode draft?"
        : "Instruction for episode draft"
      : isDialogueStage
        ? latestDialogue
          ? "What should change in the dialogue design?"
          : "Instruction for dialogue design"
        : "What should change in the key beats?";
    const composerPlaceholder = isDraftStage
      ? latestDraft
        ? "Example: Make Sophie more defensive; preserve everything else."
        : "Optional. Example: Keep it to about 12 dialogue lines and preserve the archive-room physical comedy."
      : isDialogueStage
        ? latestDialogue
          ? "Example: Make the power shift sharper and add one better V.O. anchor."
          : "Optional. Example: Make the exchange more romantic without losing the threat."
        : "Example: Make the archive-room reveal sharper and funnier.";
    return (
      <div className="border-t border-border bg-card px-6 py-4">
        <div className="mx-auto max-w-6xl">
          <label className="block">
            <span className="text-sm font-medium text-foreground">
              {composerLabel}
            </span>
            <textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={handleTextareaLineMoveKeyDown}
              disabled={isStreaming}
              placeholder={composerPlaceholder}
              className="mt-2 h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none disabled:opacity-60"
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {stage === "beats" ? (
                <>
                  <button
                    type="button"
                    disabled={!latestBeat || isStreaming}
                    onClick={generateDialogueFromFinalizedBeats}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve Beats & Build Dialogue
                  </button>
                </>
              ) : isDialogueStage ? (
                <>
                  <button
                    type="button"
                    disabled={!latestDialogue || isStreaming}
                    onClick={generateDraftFromApprovedDialogue}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve Dialogue & Generate Episode
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isStreaming}
                    onClick={nextRun}
                    className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Next Episode
                  </button>
                </>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {isDraftStage && latestDraft && (
                <button
                  type="button"
                  disabled
                  title="Dialogue Pass is coming soon."
                  className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Dialogue Pass Coming Soon
                </button>
              )}
              <button
                type="button"
                disabled={!canSend}
                onClick={sendComposer}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStreaming
                  ? `Running ${runningLabel}...`
                  : isFirstDialogue
                    ? "Build Dialogue Design"
                    : isFirstDraft
                      ? "Generate Episode"
                      : "Give Feedback"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderConfirmDialog() {
    if (!confirmDialog) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lab-confirm-title"
      >
        <section className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
          <h2 id="lab-confirm-title" className="text-base font-semibold text-foreground">
            {confirmDialog.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{confirmDialog.body}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDialog(null)}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDialog.onConfirm}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              {confirmDialog.confirmLabel}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Predefined</p>
            <h1 className="mt-1 text-xl font-semibold text-foreground">Build Predefined Episodes</h1>
          </div>
          <div className="flex rounded-full border border-border bg-muted p-1 text-xs">
            {(["inputs", "beats", "dialogue", "draft"] as LabStage[]).map((item) => (
              <span
                key={item}
                className={`rounded-full px-3 py-1 capitalize ${
                  stage === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {item === "inputs"
                  ? "Stage 1: Inputs"
                  : item === "beats"
                    ? "Stage 2: Key Beats"
                    : item === "dialogue"
                      ? "Stage 3: Dialogue"
                      : "Stage 4: Draft"}
              </span>
            ))}
          </div>
        </div>
      </div>

      {stage === "inputs" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{renderInputs()}</div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {renderContextBar()}
            {renderAutoPipelineProgress()}
            {renderPipelineSummary()}
            {renderTimeline()}
          </div>
          {renderComposer()}
        </>
      )}
      {renderConfirmDialog()}
    </main>
  );
}
