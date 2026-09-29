"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CheckCircle, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { cleanPitchIdeaText, parsePitchIdeaEnvelope } from "@/lib/pitch-lab-idea-envelope";
import { isPitchLabEnabledForClient } from "@/lib/pitch-lab-flags";

const SAMPLE_TITLE_PREFIX = "[Sample] ";

type PitchStage = "inputs" | "premises" | "pitch";
type GenerationMode = "framework" | "adaptation";
type OperationKind = "generate" | "regenerate" | "refine" | "save" | "restore" | "finalize";
type IdeaStatus = "premise" | "generated" | "shortlisted" | "discarded" | "promoted";

type Idea = {
  id: string;
  title: string;
  ideaText: string;
  status: IdeaStatus;
  promotedDocumentId?: string | null;
  updatedAt?: string | Date | null;
  isPlaceholder?: boolean;
};

type WriterDoc = { id: string; title: string; ownerName?: string | null };
type OperationState = { kind: OperationKind; startedAt: number };
type PilotGenerationTask = { startedAt: number; instruction: string };
type TimelineItem = {
  id: string;
  version: number;
  turnIndex?: number;
  instruction: string;
  ideaText: string;
  status?: "complete" | "running" | "failed";
  error?: string;
};
type ConfirmDialogState = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
};

const MAX_SHORTLISTED_PILOTS = 20;
const MAX_PARALLEL_PILOT_GENERATIONS = 2;
const DIRECTION_PLACEHOLDER = "Type anything: billionaire CEO disguised as an intern, contract marriage, revenge affair...";
const DIRECTION_EXAMPLE_TEXT = "Try: billionaire CEO disguised as an intern, contract marriage, revenge affair, fake fiance, debt trap, secret heir.";
const PILOT_GENERATION_STAGES = ["Reading idea", "Building pilot set", "Checking logic", "Saving options"];
type GeneratedBatch = {
  id: string;
  premiseId: string;
  title: string;
  generatedAt: string;
  batchNumber?: number;
  ideas: Idea[];
};

type WorkspaceResponse = {
  workspace?: { brief?: string | null; adaptationStyle?: "close" | "loose" | null } | null;
  sources?: { type: string; sourceDocumentId?: string | null; textSnapshot?: string | null }[];
  ideas?: Idea[];
};

const OPERATION_COPY: Record<OperationKind, { label: string; stages: string[]; slowHint: string }> = {
  generate: {
    label: "Creating ideas",
    stages: ["Reading source", "Creating ideas", "Checking clarity", "Saving results"],
    slowHint: "Still working. Ideas will open automatically after the new set is saved.",
  },
  regenerate: {
    label: "Regenerating pitch options",
    stages: ["Reading feedback", "Reworking selected idea", "Checking logic", "Saving options"],
    slowHint: "Regeneration waits for the full model response before replacing the current pitch batch.",
  },
  refine: {
    label: "Running Pitch Builder",
    stages: ["Reading Live File", "Applying feedback", "Validating title and pitch", "Saving option"],
    slowHint: "Pitch Builder can take a minute when real AI mode is enabled.",
  },
  save: {
    label: "Saving edit",
    stages: ["Reading edit", "Saving Live File", "Updating shortlist"],
    slowHint: "This is usually quick; if it waits, the local database may be busy.",
  },
  restore: {
    label: "Updating Live File",
    stages: ["Reading option", "Saving Live File", "Updating shortlist"],
    slowHint: "This is usually quick; if it waits, the local database may be busy.",
  },
  finalize: {
    label: "Creating Writer doc",
    stages: ["Preparing pitch", "Creating Writer tabs", "Copying plot", "Opening document"],
    slowHint: "Finalize creates a local Writer document and then opens it.",
  },
};

function displayTitle(title: string) {
  return title.startsWith(SAMPLE_TITLE_PREFIX) ? title.slice(SAMPLE_TITLE_PREFIX.length) : title;
}

function markSampleIdea(idea: Idea): Idea {
  return { ...idea, isPlaceholder: idea.isPlaceholder === true || idea.title.startsWith(SAMPLE_TITLE_PREFIX) };
}

function currentIdeaText(idea: Idea) {
  return cleanPitchIdeaText(parsePitchIdeaEnvelope(idea.ideaText).currentText);
}

function cleanPilotName(value: string) {
  return value.replace(/^\[Sample\]\s*/i, "").replace(/\s+/g, " ").trim();
}

function isValidPilotName(value: string) {
  const words = cleanPilotName(value).split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 2;
}

function timestampValue(value?: string | Date | null) {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function stageIndexForElapsed(seconds: number, stageCount: number) {
  if (stageCount <= 1) return 0;
  if (seconds < 8) return 0;
  if (seconds < 25) return Math.min(1, stageCount - 1);
  if (seconds < 55) return Math.min(2, stageCount - 1);
  return stageCount - 1;
}

export default function PitchLabStudioPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pitchLabEnabled = isPitchLabEnabledForClient();

  const [stage, setStage] = useState<PitchStage>("inputs");
  const [brief, setBrief] = useState("");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("framework");
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [pastedSource, setPastedSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [adaptationStyle, setAdaptationStyle] = useState<"close" | "loose">("loose");
  const [docs, setDocs] = useState<WriterDoc[]>([]);
  const [docSearch, setDocSearch] = useState("");
  const [docDropdownOpen, setDocDropdownOpen] = useState(false);
  const [docsLoading, setDocsLoading] = useState(true);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [conceptInstructions, setConceptInstructions] = useState("");
  const [pilotInstructionId, setPilotInstructionId] = useState<string | null>(null);
  const [pilotInstructionDrafts, setPilotInstructionDrafts] = useState<Record<string, string>>({});
  const [pilotGenerationTasks, setPilotGenerationTasks] = useState<Record<string, PilotGenerationTask>>({});
  const [pilotGenerationTick, setPilotGenerationTick] = useState(0);
  const [selectedPremiseId, setSelectedPremiseId] = useState<string | null>(null);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaInstructions, setIdeaInstructions] = useState("");
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [currentVersionNotice, setCurrentVersionNotice] = useState<string | null>(null);
  const [currentVersionInstruction, setCurrentVersionInstruction] = useState<string | null>(null);
  const [isCurrentEditable, setIsCurrentEditable] = useState(false);
  const [copyTarget, setCopyTarget] = useState<string | null>(null);
  const [pendingIdeaAction, setPendingIdeaAction] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [shortlistCandidate, setShortlistCandidate] = useState<Idea | null>(null);
  const [shortlistTitle, setShortlistTitle] = useState("");
  const [expandedPilotIds, setExpandedPilotIds] = useState<Set<string>>(() => new Set());
  const [pendingTimelineItem, setPendingTimelineItem] = useState<(TimelineItem & { ideaId: string }) | null>(null);
  const [editingOptionIds, setEditingOptionIds] = useState<Set<string>>(() => new Set());
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const ideaTextRef = useRef<HTMLTextAreaElement | null>(null);
  const pitchFeedRef = useRef<HTMLDivElement | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const previousStageRef = useRef<PitchStage>(stage);

  const isBusy = Boolean(operation);
  const activePilotGenerationCount = Object.keys(pilotGenerationTasks).length;

  useEffect(() => {
    if (!operation) {
      setElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - operation.startedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [operation]);

  useEffect(() => {
    if (!activePilotGenerationCount) {
      setPilotGenerationTick(0);
      return;
    }
    const timer = window.setInterval(() => setPilotGenerationTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [activePilotGenerationCount]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (!pitchLabEnabled || status !== "authenticated") return;

    fetch("/api/pitch-lab/workspace")
      .then((r) => r.ok ? r.json() as Promise<WorkspaceResponse> : null)
      .then((data) => {
        if (!data?.workspace) return;
        setBrief(data.workspace.brief ?? "");
        setAdaptationStyle(data.workspace.adaptationStyle ?? "loose");
        const sources = Array.isArray(data.sources) ? data.sources : [];
        const writerSource = sources.find((source) => source.type === "writer_doc");
        const pasted = sources.find((source) => source.type === "pasted_text" && !source.textSnapshot?.startsWith("Source URL:"));
        const external = sources.find((source) => source.type === "pasted_text" && source.textSnapshot?.startsWith("Source URL:"));
        setGenerationMode(sources.length ? "adaptation" : "framework");
        setSourceDocumentId(writerSource?.sourceDocumentId ?? "");
        setPastedSource((pasted?.textSnapshot ?? "").replace(/^Pasted source material:\s*/i, ""));
        setSourceUrl((external?.textSnapshot ?? "").match(/^Source URL:\s*(\S+)/m)?.[1] ?? "");
        setIdeas(Array.isArray(data.ideas) ? data.ideas.map(markSampleIdea) : []);
      })
      .catch(() => undefined);

    fetch("/api/documents")
      .then((r) => r.ok ? r.json() : [])
      .then((rows: unknown) => {
        if (!Array.isArray(rows)) return;
        setDocs(rows.map((row) => {
          const doc = row as { id: string; title: string; ownerName?: string | null };
          return { id: doc.id, title: doc.title, ownerName: doc.ownerName ?? null };
        }));
      })
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [pitchLabEnabled, router, status]);

  const premises = useMemo(() => ideas.filter((idea) => idea.status === "premise"), [ideas]);
  const generated = useMemo(() => ideas.filter((idea) => idea.status === "generated"), [ideas]);
  const shortlisted = useMemo(
    () => ideas
      .filter((idea) => idea.status === "shortlisted")
      .sort((left, right) => {
        const leftEnvelope = parsePitchIdeaEnvelope(left.ideaText);
        const rightEnvelope = parsePitchIdeaEnvelope(right.ideaText);
        return timestampValue(rightEnvelope.shortlistedAt ?? right.updatedAt) - timestampValue(leftEnvelope.shortlistedAt ?? left.updatedAt);
      }),
    [ideas]
  );
  const discarded = useMemo(() => ideas.filter((idea) => idea.status === "discarded"), [ideas]);
  const discardedPremises = useMemo(() => discarded.filter((idea) => !parsePitchIdeaEnvelope(idea.ideaText).batchId), [discarded]);
  const visiblePremises = useMemo(() => showDiscarded ? [...premises, ...discardedPremises] : premises, [discardedPremises, premises, showDiscarded]);
  const selectedPremise = useMemo(() => premises.find((idea) => idea.id === selectedPremiseId) ?? null, [premises, selectedPremiseId]);
  const selectedIdea = useMemo(() => shortlisted.find((idea) => idea.id === selectedIdeaId) ?? null, [selectedIdeaId, shortlisted]);
  const selectedEnvelope = useMemo(() => selectedIdea ? parsePitchIdeaEnvelope(selectedIdea.ideaText) : null, [selectedIdea]);
  const selectedSource = docs.find((doc) => doc.id === sourceDocumentId);
  const hasSource = Boolean(sourceDocumentId || pastedSource.trim() || sourceUrl.trim());
  const savedTitle = selectedIdea ? displayTitle(selectedIdea.title) : "";
  const savedText = cleanPitchIdeaText(selectedEnvelope?.currentText ?? "");
  const hasUnsavedEdits = Boolean(selectedIdea && (ideaTitle.trim() !== savedTitle.trim() || cleanPitchIdeaText(ideaDraft) !== savedText.trim()));
  const operationCopy = operation ? OPERATION_COPY[operation.kind] : null;
  const currentStageIndex = operationCopy ? stageIndexForElapsed(elapsedSeconds, operationCopy.stages.length) : 0;
  const primaryButtonClass = "min-h-10 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98] hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryButtonClass = "min-h-10 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition active:scale-[0.98] hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";
  const iconButtonClass = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition active:scale-[0.98] hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-50";

  const sourceSummary = generationMode === "framework"
    ? "Framework: active S1-S6 microdrama strategy"
    : selectedSource?.title
      ? `Adapt: ${selectedSource.title}`
      : pastedSource.trim()
        ? "Adapt: pasted story material"
        : sourceUrl.trim()
          ? "Adapt: public story link"
          : "Adapt: choose a source";

  const generatedBatches = useMemo<GeneratedBatch[]>(() => {
    const premiseByText = new Map(premises.map((idea) => [currentIdeaText(idea).trim(), idea.id]));
    const rows = [
      ...generated,
      ...shortlisted,
      ...(showDiscarded ? discarded.filter((idea) => {
        const batchId = parsePitchIdeaEnvelope(idea.ideaText).batchId;
        return Boolean(batchId);
      }) : []),
    ];
    const groups = new Map<string, GeneratedBatch & { latestPosition: number }>();
    rows.forEach((idea, index) => {
      const envelope = parsePitchIdeaEnvelope(idea.ideaText);
      const premiseId = envelope.premiseId || (envelope.premise ? premiseByText.get(envelope.premise.trim()) : undefined);
      if (!premiseId) return;
      const batchKey = envelope.batchId || `legacy:${premiseId}:${envelope.generatedAt || envelope.premise || idea.id}`;
      const existing = groups.get(batchKey);
      const generatedAt = envelope.generatedAt || "";
      if (existing) {
        existing.ideas.push(idea);
        existing.latestPosition = Math.max(existing.latestPosition, index);
        if (generatedAt > existing.generatedAt) existing.generatedAt = generatedAt;
      } else {
        groups.set(batchKey, {
          id: batchKey,
          premiseId,
          title: envelope.batchNumber ? `Set ${envelope.batchNumber}` : "Generated set",
          generatedAt,
          batchNumber: envelope.batchNumber,
          ideas: [idea],
          latestPosition: index,
        });
      }
    });
    return [...groups.values()]
      .sort((left, right) => (right.generatedAt || "").localeCompare(left.generatedAt || "") || right.latestPosition - left.latestPosition)
      .slice(0, 10);
  }, [discarded, generated, premises, shortlisted, showDiscarded]);

  const filteredDocs = useMemo(() => {
    const query = docSearch.trim().toLocaleLowerCase();
    return query ? docs.filter((doc) => `${doc.title} ${doc.ownerName ?? ""}`.toLocaleLowerCase().includes(query)) : docs;
  }, [docSearch, docs]);

  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (!selectedEnvelope) return [];
    const items: TimelineItem[] = selectedEnvelope.turns.reduce<TimelineItem[]>((current, turn, turnIndex) => {
      if (turn.kind !== "rewrite") return current;
      current.push({
        id: `${turn.createdAt || "version"}-${turnIndex}`,
        version: current.length + 1,
        turnIndex,
        instruction: turn.instruction,
        ideaText: cleanPitchIdeaText(turn.ideaText),
        status: "complete",
      });
      return current;
    }, []);
    if (selectedIdea && pendingTimelineItem?.ideaId === selectedIdea.id) {
      items.push({
        id: pendingTimelineItem.id,
        version: items.length + 1,
        instruction: pendingTimelineItem.instruction,
        ideaText: pendingTimelineItem.ideaText,
        status: pendingTimelineItem.status,
        error: pendingTimelineItem.error,
      });
    }
    return items;
  }, [pendingTimelineItem, selectedEnvelope, selectedIdea]);

  useEffect(() => {
    if (!copyTarget) return;
    const timeout = window.setTimeout(() => setCopyTarget(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copyTarget]);

  useEffect(() => {
    setIdeaDraft(cleanPitchIdeaText(selectedEnvelope?.currentText ?? ""));
    setIdeaTitle(selectedIdea ? displayTitle(selectedIdea.title) : "");
    setIdeaInstructions("");
    setCurrentVersionNotice(null);
    setCurrentVersionInstruction(null);
    setIsCurrentEditable(false);
    setEditingOptionIds(new Set());
    setOptionDrafts({});
  }, [selectedEnvelope, selectedIdea]);

  useEffect(() => {
    if (!pendingTimelineItem || pendingTimelineItem.ideaId !== selectedIdeaId) return;
    pitchFeedRef.current?.scrollTo({ top: pitchFeedRef.current.scrollHeight, behavior: "smooth" });
  }, [pendingTimelineItem, selectedIdeaId]);

  useEffect(() => {
    if (shortlisted.length === 0) {
      setSelectedIdeaId(null);
      return;
    }
    if (!selectedIdeaId || !shortlisted.some((idea) => idea.id === selectedIdeaId)) {
      setSelectedIdeaId(shortlisted[0].id);
    }
  }, [selectedIdeaId, shortlisted]);

  useEffect(() => {
    const previousStage = previousStageRef.current;
    previousStageRef.current = stage;
    if (stage === "pitch" && previousStage !== "pitch" && shortlisted[0]) {
      setSelectedIdeaId(shortlisted[0].id);
    }
  }, [shortlisted, stage]);

  useEffect(() => {
    if (stage === "pitch" && shortlisted.length === 0) setStage(premises.length ? "premises" : "inputs");
    if (stage === "premises" && premises.length === 0) setStage("inputs");
  }, [premises.length, shortlisted.length, stage]);

  function startOperation(kind: OperationKind) {
    setOperation({ kind, startedAt: Date.now() });
    setElapsedSeconds(0);
    setError(null);
  }

  function finishOperation() {
    setOperation(null);
  }

  function failOperation(message: string) {
    setOperation(null);
    setError(message);
  }

  async function copyText(text: string, target: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(cleanPitchIdeaText(text));
      setCopyTarget(target);
    } catch {
      setCopyTarget(null);
    }
  }

  function togglePilotExpanded(id: string) {
    setExpandedPilotIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectedPremise(id: string) {
    const scrollNode = mainScrollRef.current;
    const previousScrollTop = scrollNode?.scrollTop ?? null;
    setSelectedPremiseId((current) => current === id ? null : id);
    window.requestAnimationFrame(() => {
      if (scrollNode && previousScrollTop !== null) scrollNode.scrollTop = previousScrollTop;
    });
  }

  function statusTag(label: string, tone: "neutral" | "blue" | "emerald" | "amber" | "red" = "neutral", extra = "") {
    const toneClass = tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          : tone === "red"
            ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            : "border-border bg-muted text-muted-foreground";
    return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneClass} ${extra}`}>{label}</span>;
  }

  async function generatePremises(instructionOverride = "") {
    const instruction = instructionOverride.trim();
    setConfirmDialog(null);
    startOperation("generate");
    try {
      const response = await fetch("/api/pitch-lab/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "premises",
          generationType: generationMode,
          brief,
          sourceDocumentId: generationMode === "adaptation" ? sourceDocumentId || null : null,
          pastedSource: generationMode === "adaptation" ? pastedSource : "",
          sourceUrl: generationMode === "adaptation" ? sourceUrl : "",
          adaptationStyle: generationMode === "adaptation" && hasSource ? adaptationStyle : null,
          instruction,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `Idea generation failed (${response.status}).`);
      const newIdeas = Array.isArray(data.ideas) ? data.ideas.map((idea: Idea) => markSampleIdea(idea)) : [];
      setIdeas((current) => [
        ...newIdeas,
        ...current.filter((idea) => idea.status === "shortlisted" || idea.status === "promoted"),
      ]);
      setSelectedPremiseId(null);
      setShowDiscarded(false);
      setStage("premises");
      finishOperation();
    } catch (err) {
      failOperation(err instanceof Error ? err.message : "Could not generate ideas.");
    }
  }

  function requestGeneratePremises() {
    const hasReplaceableWork = premises.length > 0 || generated.length > 0 || discarded.length > 0;
    if (hasReplaceableWork) {
      setConfirmDialog({
        title: "Create new ideas?",
        body: "This will create a new list of ideas. Only shortlisted pilots will remain. Are you sure?",
        confirmLabel: "Yes",
        onConfirm: () => {
          setConfirmDialog(null);
          void generatePremises();
        },
      });
      return;
    }
    void generatePremises();
  }

  async function generate(regenerate = false, premiseOverride = "", premiseIdOverride = selectedPremiseId ?? "", instructionOverride = "") {
    const premiseText = premiseOverride || (selectedPremise ? currentIdeaText(selectedPremise) : "");
    const premiseId = premiseIdOverride || selectedPremiseId || "";
    const instruction = instructionOverride.trim();
    if (!premiseText.trim()) {
      setError("Choose an idea before generating pitch options.");
      setStage(premises.length ? "premises" : "inputs");
      return;
    }
    if (!premiseId) {
      setError("Choose an idea before generating pitch options.");
      return;
    }
    if (pilotGenerationTasks[premiseId]) return;
    if (activePilotGenerationCount >= MAX_PARALLEL_PILOT_GENERATIONS) {
      setError(`Wait for one pilot generation to finish. You can run ${MAX_PARALLEL_PILOT_GENERATIONS} at a time.`);
      return;
    }
    setConfirmDialog(null);
    setError(null);
    setSelectedPremiseId(premiseId);
    setPilotInstructionId(null);
    setPilotGenerationTasks((current) => ({ ...current, [premiseId]: { startedAt: Date.now(), instruction } }));
    try {
      const response = await fetch("/api/pitch-lab/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "pilots",
          generationType: generationMode,
          brief,
          sourceDocumentId: generationMode === "adaptation" ? sourceDocumentId || null : null,
          pastedSource: generationMode === "adaptation" ? pastedSource : "",
          sourceUrl: generationMode === "adaptation" ? sourceUrl : "",
          adaptationStyle: generationMode === "adaptation" && hasSource ? adaptationStyle : null,
          selectedPremise: premiseText,
          selectedPremiseId: premiseId,
          instruction: regenerate ? conceptInstructions : instruction,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `Generation failed (${response.status}).`);
      const newIdeas = Array.isArray(data.ideas) ? data.ideas.map((idea: Idea) => markSampleIdea(idea)) : [];
      setIdeas((current) => [
        ...current.filter((idea) => !newIdeas.some((newIdea: Idea) => newIdea.id === idea.id)),
        ...newIdeas,
      ]);
      setShowDiscarded(false);
      setConceptInstructions("");
      setPilotInstructionDrafts((current) => {
        const next = { ...current };
        delete next[premiseId];
        return next;
      });
      setStage("premises");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate pitch options.");
    } finally {
      setPilotGenerationTasks((current) => {
        const next = { ...current };
        delete next[premiseId];
        return next;
      });
    }
  }

  function requestGeneratePilots(premiseId: string, premiseText: string, instruction = "") {
    setSelectedPremiseId(premiseId);
    void generate(false, premiseText, premiseId, instruction);
  }

  async function setIdeaStatus(id: string, next: Exclude<IdeaStatus, "promoted">, options: { title?: string; select?: boolean } = {}) {
    setError(null);
    setPendingIdeaAction(`${id}:${next}`);
    try {
      const response = await fetch(`/api/pitch-lab/ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, title: options.title }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update idea.");
      const updated = data?.idea as Idea | undefined;
      setIdeas((current) => current.map((idea) => idea.id === id ? { ...idea, ...(updated ?? {}), status: next, title: updated?.title ?? options.title ?? idea.title } : idea));
      if (next === "shortlisted" && options.select) {
        setSelectedIdeaId(id);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update idea.");
      return false;
    } finally {
      setPendingIdeaAction(null);
    }
  }

  async function saveIdea(instructionOverride = ideaInstructions, ideaTextOverride?: string) {
    if (!selectedIdea) return;
    const instruction = instructionOverride.trim();
    const sourceText = cleanPitchIdeaText(ideaTextOverride ?? ideaDraft);
    const pendingId = `pending-${Date.now()}`;
    if (instruction) {
      setPendingTimelineItem({
        ideaId: selectedIdea.id,
        id: pendingId,
        version: timelineItems.length + 1,
        instruction,
        ideaText: "Pitch Builder is improving this pilot...",
        status: "running",
      });
      setIdeaInstructions("");
      requestAnimationFrame(() => {
        pitchFeedRef.current?.scrollTo({ top: pitchFeedRef.current.scrollHeight, behavior: "smooth" });
      });
    }
    startOperation(instruction ? "refine" : "save");
    try {
      const response = await fetch("/api/pitch-lab/ideas/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaId: selectedIdea.id,
          title: ideaTitle,
          ideaText: sourceText,
          instruction,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update idea.");
      const currentText = typeof data?.currentText === "string" ? data.currentText : parsePitchIdeaEnvelope(data.ideaText ?? "").currentText;
      const cleanTitle = typeof data?.title === "string" ? data.title : ideaTitle || displayTitle(selectedIdea.title);
      setIdeaDraft(currentText);
      setIdeaTitle(cleanTitle);
      const isPlaceholder = selectedIdea.isPlaceholder === true || data.isPlaceholder === true;
      setIdeas((current) => current.map((idea) => idea.id === selectedIdea.id ? { ...idea, title: cleanTitle, ideaText: data.ideaText, isPlaceholder } : idea));
      setPendingTimelineItem(null);
      setIsCurrentEditable(false);
      setCurrentVersionNotice(instruction ? "Generated option added below the Live File." : "Manual edits saved to the Live File.");
      setCurrentVersionInstruction(instruction || null);
      finishOperation();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update idea.";
      if (instruction) {
        setPendingTimelineItem({
          ideaId: selectedIdea.id,
          id: pendingId,
          version: timelineItems.length + 1,
          instruction,
          ideaText: "",
          status: "failed",
          error: message,
        });
      }
      failOperation(message);
    }
  }

  function optionDraftText(item: TimelineItem) {
    return cleanPitchIdeaText(optionDrafts[item.id] ?? item.ideaText);
  }

  function toggleOptionEdit(item: TimelineItem) {
    setOptionDrafts((current) => ({ ...current, [item.id]: current[item.id] ?? item.ideaText }));
    setEditingOptionIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  async function saveOptionEdit(item: TimelineItem) {
    if (!selectedIdea || item.turnIndex === undefined) return;
    const editedText = optionDraftText(item);
    if (!editedText) return;
    startOperation("save");
    try {
      const response = await fetch("/api/pitch-lab/ideas/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaId: selectedIdea.id,
          title: ideaTitle,
          ideaText: editedText,
          instruction: "",
          turnIndex: item.turnIndex,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not save generated option.");
      setIdeas((current) => current.map((idea) => idea.id === selectedIdea.id ? { ...idea, ideaText: data.ideaText } : idea));
      setEditingOptionIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setOptionDrafts((current) => ({ ...current, [item.id]: editedText }));
      setCurrentVersionNotice("Generated option saved. Live File was not changed.");
      setCurrentVersionInstruction(null);
      finishOperation();
    } catch (err) {
      failOperation(err instanceof Error ? err.message : "Could not save generated option.");
    }
  }

  async function promoteIdea(ideaTextOverride?: string) {
    if (!selectedIdea) return;
    if (hasUnsavedEdits) {
      setError("Save or cancel edits before creating the Writer doc.");
      return;
    }
    startOperation("finalize");
    try {
      let titleForDoc = ideaTitle;
      if (ideaTextOverride) {
        const cleanText = cleanPitchIdeaText(ideaTextOverride);
        const updateResponse = await fetch("/api/pitch-lab/ideas/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ideaId: selectedIdea.id,
            title: ideaTitle,
            ideaText: cleanText,
            instruction: "",
          }),
        });
        const updateData = await updateResponse.json().catch(() => null);
        if (!updateResponse.ok) throw new Error(updateData?.error || "Could not prepare this option for the Writer doc.");
        const currentText = typeof updateData?.currentText === "string" ? updateData.currentText : parsePitchIdeaEnvelope(updateData.ideaText ?? "").currentText;
        const cleanTitle = typeof updateData?.title === "string" ? updateData.title : ideaTitle || displayTitle(selectedIdea.title);
        titleForDoc = cleanTitle;
        setIdeaDraft(currentText);
        setIdeaTitle(cleanTitle);
        const isPlaceholder = selectedIdea.isPlaceholder === true || updateData.isPlaceholder === true;
        setIdeas((current) => current.map((idea) => idea.id === selectedIdea.id ? { ...idea, title: cleanTitle, ideaText: updateData.ideaText, isPlaceholder } : idea));
        setCurrentVersionNotice(null);
        setCurrentVersionInstruction(null);
        setIsCurrentEditable(false);
      }
      const response = await fetch("/api/pitch-lab/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId: selectedIdea.id, title: titleForDoc }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not create Writer document.");
      finishOperation();
      router.push(`/doc/${data.id}`);
    } catch (err) {
      failOperation(err instanceof Error ? err.message : "Could not create Writer document.");
    }
  }

  function openShortlistDialog(idea: Idea) {
    setError(null);
    if (shortlisted.length >= MAX_SHORTLISTED_PILOTS) {
      setError(`Shortlist is full at ${MAX_SHORTLISTED_PILOTS} pilots. Discard items from Shortlist before adding more.`);
      return;
    }
    setShortlistCandidate(idea);
    setShortlistTitle(cleanPilotName(displayTitle(idea.title)));
  }

  async function confirmShortlist() {
    if (!shortlistCandidate) return;
    const title = cleanPilotName(shortlistTitle);
    if (!isValidPilotName(title)) {
      setError("Use a pilot name of one or two words.");
      return;
    }
    const ok = await setIdeaStatus(shortlistCandidate.id, "shortlisted", { title, select: false });
    if (ok) {
      setShortlistCandidate(null);
      setShortlistTitle("");
    }
  }

  function renderAlerts() {
    return (
      <>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      </>
    );
  }

  function renderOperationCard() {
    if (!operation || !operationCopy) return null;
    return (
      <article role="status" aria-live="polite" aria-busy="true" className="rounded-lg border border-amber-300 bg-card p-4 dark:border-amber-900">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{operation.kind === "generate" || operation.kind === "regenerate" ? "Pitch Lab" : operation.kind === "finalize" ? "Writer Doc Builder" : "Pitch Builder"}</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-200">RUNNING</span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">{formatElapsed(elapsedSeconds)}</span>
        </div>
        <p className="text-sm font-medium text-foreground">{operationCopy.label}.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {operation.kind === "generate"
            ? "Stay here while the model creates ideas. The list will update when the result is saved."
            : elapsedSeconds >= 45
              ? operationCopy.slowHint
              : "This will update as soon as the result is saved."}
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {operationCopy.stages.map((step, index) => {
            const isCurrent = index === currentStageIndex;
            const isDone = index < currentStageIndex;
            return (
              <li key={step} className={`rounded-md border px-3 py-2 text-xs font-medium ${isCurrent ? "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : isDone ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-border bg-muted/40 text-muted-foreground"}`}>
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">{isDone ? "OK" : index + 1}</span>
                {step}
              </li>
            );
          })}
        </ol>
      </article>
    );
  }

  function renderPilotGenerationCard(task: PilotGenerationTask) {
    const now = Date.now() + pilotGenerationTick * 0;
    const seconds = Math.max(0, Math.floor((now - task.startedAt) / 1000));
    const stageIndex = stageIndexForElapsed(seconds, PILOT_GENERATION_STAGES.length);
    return (
      <article role="status" aria-live="polite" aria-busy="true" className="rounded-lg border border-amber-300 bg-card p-4 dark:border-amber-900">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Pilot Episodes</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-200">RUNNING</span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">{formatElapsed(seconds)}</span>
        </div>
        <p className="text-sm font-medium text-foreground">Generating 4 pilot options.</p>
        {task.instruction && <p className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">Instruction: {task.instruction}</p>}
        <p className="mt-1 text-sm text-muted-foreground">This idea will show its pilot set as soon as the result is saved.</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PILOT_GENERATION_STAGES.map((step, index) => {
            const isCurrent = index === stageIndex;
            const isDone = index < stageIndex;
            return (
              <li key={step} className={`rounded-md border px-3 py-2 text-xs font-medium ${isCurrent ? "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : isDone ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-border bg-muted/40 text-muted-foreground"}`}>
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">{isDone ? "OK" : index + 1}</span>
                {step}
              </li>
            );
          })}
        </ol>
      </article>
    );
  }

  function renderConfirmDialog() {
    if (!confirmDialog) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby="pitch-confirm-title" className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
          <h2 id="pitch-confirm-title" className="text-base font-semibold text-foreground">{confirmDialog.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{confirmDialog.body}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDialog(null)} className={secondaryButtonClass}>No</button>
            <button type="button" onClick={confirmDialog.onConfirm} className={primaryButtonClass}>{confirmDialog.confirmLabel}</button>
          </div>
        </section>
      </div>
    );
  }

  function renderShortlistDialog() {
    if (!shortlistCandidate) return null;
    const title = cleanPilotName(shortlistTitle);
    const isValid = isValidPilotName(title);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby="shortlist-confirm-title" className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
          <h2 id="shortlist-confirm-title" className="text-base font-semibold text-foreground">Add pilot to Shortlist?</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Give this pilot a name before adding it to Shortlist.</p>
          <label htmlFor="shortlist-pilot-title" className="mt-4 block text-sm font-medium text-foreground">Pilot name</label>
          <input id="shortlist-pilot-title" value={shortlistTitle} onChange={(event) => setShortlistTitle(event.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <p className={`mt-2 text-xs ${isValid ? "text-muted-foreground" : "text-red-600 dark:text-red-300"}`}>Use the most powerful identifiable noun, 1-2 words.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => { setShortlistCandidate(null); setShortlistTitle(""); }} className={secondaryButtonClass}>No</button>
            <button type="button" onClick={() => void confirmShortlist()} disabled={!isValid || Boolean(pendingIdeaAction)} className={primaryButtonClass}>{pendingIdeaAction === `${shortlistCandidate.id}:shortlisted` ? "Adding..." : "Yes"}</button>
          </div>
        </section>
      </div>
    );
  }

  function renderInputs() {
    return (
      <section className="mx-auto max-w-4xl rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pitch Lab</p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">Create ideas</h2>
          </div>
          <div className="grid min-h-10 grid-cols-2 rounded-md border border-border bg-muted p-1 text-sm">
            <button type="button" onClick={() => setGenerationMode("framework")} aria-pressed={generationMode === "framework"} className={`rounded px-3 py-1.5 font-medium transition active:scale-[0.98] ${generationMode === "framework" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              Fresh
            </button>
            <button type="button" onClick={() => setGenerationMode("adaptation")} aria-pressed={generationMode === "adaptation"} className={`rounded px-3 py-1.5 font-medium transition active:scale-[0.98] ${generationMode === "adaptation" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              Adapt
            </button>
          </div>
        </div>

        {generationMode === "framework" ? (
          <div className="mt-5 space-y-4">
            <label htmlFor="pitch-brief" className="block text-sm font-medium">
              Seed idea
              <textarea id="pitch-brief" value={brief} onChange={(event) => setBrief(event.target.value)} rows={5} className="mt-2 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm font-normal leading-6 outline-none transition-colors focus:border-emerald-500" placeholder={DIRECTION_PLACEHOLDER} />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">{DIRECTION_EXAMPLE_TEXT}</p>
            <p className="text-xs leading-5 text-muted-foreground">This text is sent into generation and should steer the first set of ideas.</p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label htmlFor="source-document-search" className="block text-sm font-medium">Source story</label>
            <div className="relative">
              <div className="flex min-h-11 items-center rounded-md border border-border bg-background focus-within:border-emerald-500">
                <input id="source-document-search" type="search" role="combobox" value={docDropdownOpen ? docSearch : selectedSource?.title ?? docSearch} onFocus={() => { setDocSearch(""); setDocDropdownOpen(true); }} onBlur={() => setDocDropdownOpen(false)} onChange={(event) => { setDocSearch(event.target.value); setSourceDocumentId(""); setDocDropdownOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setDocDropdownOpen(false); }} className="w-full bg-transparent px-3 py-2 text-sm outline-none" placeholder={selectedSource && !docDropdownOpen ? selectedSource.title : "Search Writer docs..."} aria-controls="source-document-results" aria-expanded={docDropdownOpen} aria-haspopup="listbox" aria-autocomplete="list" autoComplete="off" />
                {selectedSource && !docDropdownOpen && <span className="mr-3 shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">Selected</span>}
              </div>
              {docDropdownOpen && <div id="source-document-results" role="listbox" aria-label="All Writer docs" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                {docsLoading ? <p className="px-3 py-3 text-sm text-muted-foreground">Loading Writer docs...</p> : filteredDocs.length ? filteredDocs.map((doc) => <button type="button" role="option" aria-selected={doc.id === sourceDocumentId} key={doc.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSourceDocumentId(doc.id); setDocSearch(doc.title); setDocDropdownOpen(false); }} className={`flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted ${doc.id === sourceDocumentId ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}><span className="font-medium">{doc.title}</span><span className="shrink-0 text-xs text-muted-foreground">{doc.ownerName || "Unknown owner"}</span></button>) : <p className="px-3 py-3 text-sm text-muted-foreground">{docs.length ? "No Writer docs match that search." : "No Writer docs yet. Paste story material below."}</p>}
              </div>}
            </div>
            <textarea id="pasted-source" value={pastedSource} onChange={(event) => setPastedSource(event.target.value)} rows={5} className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus:border-emerald-500" placeholder="Or paste source material here." />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <input id="external-story-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500" placeholder="Optional public link" />
              <select value={adaptationStyle} onChange={(event) => setAdaptationStyle(event.target.value as "close" | "loose")} className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500" aria-label="Adaptation distance">
                <option value="loose">Loose adaptation</option>
                <option value="close">Close adaptation</option>
              </select>
            </div>
            <textarea id="pitch-brief-adaptation" value={brief} onChange={(event) => setBrief(event.target.value)} rows={3} className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus:border-emerald-500" placeholder={DIRECTION_PLACEHOLDER} />
            <p className="text-xs leading-5 text-muted-foreground">{DIRECTION_EXAMPLE_TEXT}</p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">{generationMode === "framework" ? "Uses the active S1-S6 microdrama strategy." : hasSource ? sourceSummary : "Choose a Writer doc, paste material, or add a link."}</p>
          <div className="flex flex-wrap gap-2">
            {premises.length > 0 && <button type="button" onClick={() => setStage("premises")} className={secondaryButtonClass}>View</button>}
            <button type="button" onClick={requestGeneratePremises} disabled={isBusy || (generationMode === "adaptation" && !hasSource)} className={primaryButtonClass}>{operation?.kind === "generate" ? "Generate..." : "Generate"}</button>
          </div>
        </div>
        {operation?.kind === "generate" && <div className="mt-4">{renderOperationCard()}</div>}
      </section>
    );
  }

  function renderPilotOptionCard(idea: Idea) {
    const isShortlisted = idea.status === "shortlisted";
    const isDiscarded = idea.status === "discarded";
    const isDiscarding = pendingIdeaAction === `${idea.id}:discarded`;
    const isExpanded = expandedPilotIds.has(idea.id);
    const isShortlistFull = shortlisted.length >= MAX_SHORTLISTED_PILOTS;
    const text = currentIdeaText(idea);
    return (
      <article key={idea.id} className={`rounded-md border border-border ${isDiscarded ? "bg-muted/40 opacity-75" : "bg-card"}`} aria-busy={isDiscarding}>
        <div className="grid gap-3 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{displayTitle(idea.title)}</h3>
              {statusTag("Pilot", "blue")}
              {isShortlisted && <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><CheckCircle className="h-3 w-3" aria-hidden="true" />Shortlisted</span>}
              {isDiscarded && statusTag("Discarded", "red")}
              {isDiscarding && <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Discarding</span>}
            </div>
            {!isExpanded && <p className="mt-1 overflow-hidden text-sm leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{text}</p>}
          </div>
          <div className="flex items-center gap-2 md:justify-end">
            {isShortlisted ? (
              <span className="inline-flex min-h-10 items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">Shortlisted</span>
            ) : null}
            <button type="button" onClick={() => togglePilotExpanded(idea.id)} aria-expanded={isExpanded} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition active:scale-[0.98] hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
              {isExpanded ? "Hide" : "View more"}
              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="border-t border-border px-3 py-3">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{text}</pre>
            {(isDiscarded || !isShortlisted) && (
              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                {isDiscarded ? (
                  <button type="button" onClick={() => void setIdeaStatus(idea.id, "generated")} disabled={Boolean(pendingIdeaAction)} className={secondaryButtonClass}>{pendingIdeaAction === `${idea.id}:generated` ? "Restoring..." : "Restore"}</button>
                ) : (
                  <>
                    {isShortlistFull && (
                      <p role="alert" className="mr-auto max-w-xl rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                        Shortlist is full at {MAX_SHORTLISTED_PILOTS}/{MAX_SHORTLISTED_PILOTS}. Delete or reject an item from Shortlist, then add this pilot.
                      </p>
                    )}
                    <button type="button" onClick={() => openShortlistDialog(idea)} disabled={Boolean(pendingIdeaAction) || isShortlistFull} className={primaryButtonClass}>{isShortlistFull ? "Shortlist full" : "Shortlist"}</button>
                    <button type="button" onClick={() => void setIdeaStatus(idea.id, "discarded")} disabled={Boolean(pendingIdeaAction)} className={secondaryButtonClass}>{isDiscarding ? "Deleting..." : "Discard"}</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    );
  }

  function renderStoryDirections() {
    return (
      <section className="space-y-3">
        {premises.length === 0 && discardedPremises.length === 0 ? (
          <section className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">Ideas will appear here after Start.</section>
        ) : (
          visiblePremises.map((idea) => {
            const isSelected = selectedPremise?.id === idea.id;
            const isDiscarded = idea.status === "discarded";
            const isDiscarding = pendingIdeaAction === `${idea.id}:discarded`;
            const text = currentIdeaText(idea);
            const envelope = parsePitchIdeaEnvelope(idea.ideaText);
            const pilotTask = pilotGenerationTasks[idea.id];
            const isGeneratingThis = Boolean(pilotTask);
            const isPilotInstructionOpen = pilotInstructionId === idea.id;
            const pilotInstruction = pilotInstructionDrafts[idea.id] ?? "";
            const batchIdeas = generatedBatches.filter((batch) => batch.premiseId === idea.id).flatMap((batch) => batch.ideas);
            const hasGeneratedPilots = batchIdeas.length > 0;
            const canStartPilotGeneration = !isBusy && !isGeneratingThis && activePilotGenerationCount < MAX_PARALLEL_PILOT_GENERATIONS;
            const directionCardClass = isGeneratingThis
              ? "border-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]"
              : hasGeneratedPilots
                ? "border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]"
                : isSelected
                  ? "border-emerald-500"
                  : "border-border";
            return (
              <article key={idea.id} className={`rounded-md border bg-card transition-colors ${directionCardClass} ${isDiscarded ? "opacity-70" : ""}`} aria-busy={isGeneratingThis}>
                <div className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_11.5rem] md:items-start">
                  <div className="min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{displayTitle(idea.title)}</h2>
                      {statusTag("Idea", generationMode === "adaptation" ? "blue" : "neutral")}
                      {isGeneratingThis && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Running</span>}
                      {batchIdeas.length > 0 && statusTag("Pilots ready", "blue")}
                      {isDiscarded && statusTag("Discarded", "red")}
                      {isDiscarding && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Discarding</span>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{text}</p>
                    {hasGeneratedPilots && !isSelected && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                        <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Pilots generated. Expand to view options.
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-[3rem_8rem] items-center justify-end gap-2 md:w-[11.5rem] md:shrink-0">
                    {isDiscarded ? (
                      <button type="button" onClick={() => void setIdeaStatus(idea.id, "premise")} disabled={Boolean(pendingIdeaAction)} className={secondaryButtonClass}>{pendingIdeaAction === `${idea.id}:premise` ? "Restore..." : "Restore"}</button>
                    ) : (
                      <>
                        {hasGeneratedPilots ? (
                          <span aria-hidden="true" />
                        ) : (
                          <button type="button" onClick={() => void setIdeaStatus(idea.id, "discarded")} disabled={Boolean(pendingIdeaAction) || isGeneratingThis} aria-label={`Discard ${displayTitle(idea.title)}`} title="Discard" className={iconButtonClass}>
                            {isDiscarding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                          </button>
                        )}
                        {!hasGeneratedPilots && (
                          <button type="button" title="Add optional instructions before creating 4 pilot options." onClick={() => {
                            setSelectedPremiseId(idea.id);
                            setPilotInstructionId((current) => current === idea.id ? null : idea.id);
                          }} disabled={!canStartPilotGeneration && !isGeneratingThis} className={`${secondaryButtonClass} w-32 px-2`}>
                            {isGeneratingThis ? <span className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap"><Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />Generating</span> : "Pilot prompt"}
                          </button>
                        )}
                      </>
                    )}
                    {hasGeneratedPilots && (
                      <div className="flex w-32 justify-end">
                        <button type="button" onClick={() => toggleSelectedPremise(idea.id)} aria-label={isSelected ? `Hide ${displayTitle(idea.title)} pilots` : `Show ${displayTitle(idea.title)} pilots`} title={isSelected ? "Hide pilots" : "Show pilots"} aria-expanded={isSelected} className={iconButtonClass}>
                          <ChevronDown className={`h-4 w-4 transition-transform ${isSelected ? "rotate-180" : ""}`} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <div className="border-t border-border px-3 py-3">
                    {envelope.adaptationNotes && <p className="mt-2 break-words text-xs text-muted-foreground">{envelope.adaptationNotes}</p>}
                    {isPilotInstructionOpen && !hasGeneratedPilots && !isGeneratingThis && (
                      <div className={envelope.adaptationNotes ? "mt-3 rounded-md border border-border bg-background/60 p-3" : "rounded-md border border-border bg-background/60 p-3"}>
                        <label htmlFor={`pilot-instruction-${idea.id}`} className="block text-sm font-medium">Pilot instruction</label>
                        <textarea id={`pilot-instruction-${idea.id}`} value={pilotInstruction} onChange={(event) => setPilotInstructionDrafts((current) => ({ ...current, [idea.id]: event.target.value }))} rows={3} className="mt-2 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Optional: make the heroine more active, avoid caregiver setup, change the cliffhanger..." />
                        {activePilotGenerationCount >= MAX_PARALLEL_PILOT_GENERATIONS && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Two pilot generations are already running.</p>}
                        <div className="mt-3 flex justify-end gap-2">
                          <button type="button" onClick={() => setPilotInstructionId(null)} className={secondaryButtonClass}>Cancel</button>
                          <button type="button" onClick={() => requestGeneratePilots(idea.id, text, pilotInstruction)} disabled={!canStartPilotGeneration} className={primaryButtonClass}>Generate pilots</button>
                        </div>
                      </div>
                    )}
                    {pilotTask && <div className={envelope.adaptationNotes || isPilotInstructionOpen ? "mt-3" : ""}>{renderPilotGenerationCard(pilotTask)}</div>}
                    {batchIdeas.length > 0 && (
                      <div className={`${envelope.adaptationNotes || isGeneratingThis ? "mt-4 border-t pt-3" : ""} space-y-3 border-border`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">Current pilots</h3>
                            {statusTag("Pilot set", "blue")}
                          </div>
                          <p className="text-xs text-muted-foreground">{batchIdeas.length} option{batchIdeas.length === 1 ? "" : "s"}</p>
                        </div>
                        <div className="space-y-3">
                          {batchIdeas.map((pilot) => renderPilotOptionCard(pilot))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
        {discardedPremises.length > 0 && (
          <button type="button" onClick={() => setShowDiscarded((show) => !show)} className="min-h-11 px-1 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground">
            {showDiscarded ? "Hide discarded" : `View discarded (${discardedPremises.length})`}
          </button>
        )}
      </section>
    );
  }

  function renderPitchTimeline() {
    if (shortlisted.length === 0) return <section className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">Shortlist a pitch option to improve it.</section>;
    return (
      <section className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-card p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Shortlisted ideas</h2>
            {statusTag(`${shortlisted.length}/${MAX_SHORTLISTED_PILOTS}`, shortlisted.length >= MAX_SHORTLISTED_PILOTS ? "amber" : "neutral")}
          </div>
          <div className="space-y-2">
            {shortlisted.map((idea) => {
              const isActive = selectedIdeaId === idea.id;
              const text = currentIdeaText(idea);
              return (
                <button
                  key={idea.id}
                  type="button"
                  onClick={() => setSelectedIdeaId(idea.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`w-full rounded-md border px-3 py-2 text-left transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 ${isActive ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-border hover:bg-muted"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">{displayTitle(idea.title)}</h3>
                    {isActive && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Selected</span>}
                  </div>
                  <p className="mt-1 overflow-hidden text-xs leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{text}</p>
                </button>
              );
            })}
          </div>
        </aside>

        {!selectedIdea ? (
          <section className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">Select a shortlisted idea to improve it.</section>
        ) : (
          <section className="space-y-4">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Shortlist Studio</p><h2 className="mt-1 text-lg font-semibold">{savedTitle || "Shortlisted idea"}</h2></div>
                <button type="button" onClick={() => void setIdeaStatus(selectedIdea.id, "discarded")} disabled={isBusy || Boolean(pendingIdeaAction)} className="min-h-10 px-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">{pendingIdeaAction === `${selectedIdea.id}:discarded` ? "Deleting..." : "Reject"}</button>
              </div>
              {currentVersionNotice && (
                <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                  <span>{currentVersionNotice}</span>
                  {currentVersionInstruction && (
                    <span className="ml-2 text-sky-700 dark:text-sky-300">Instruction: {currentVersionInstruction}</span>
                  )}
                </div>
              )}
            </section>
            <div ref={pitchFeedRef} className="max-h-[calc(100vh-20rem)] space-y-3 overflow-y-auto pr-1">
              <article className="rounded-lg border border-emerald-300 bg-card p-4 dark:border-emerald-900">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">Live File</h2>
                    {statusTag("Selected", "emerald")}
                  </div>
                  {!isCurrentEditable && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => { setIsCurrentEditable(true); requestAnimationFrame(() => ideaTextRef.current?.focus()); }} disabled={isBusy} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">Edit</button>
                      <button type="button" onClick={() => saveIdea("Regenerate the Live File into a new generated option.", savedText)} disabled={isBusy || hasUnsavedEdits} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">{operation?.kind === "refine" ? "Regenerating..." : "Regenerate"}</button>
                      <button type="button" onClick={() => copyText(savedText, "live-file-top")} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">{copyTarget === "live-file-top" ? "Copied" : "Copy"}</button>
                    </div>
                  )}
                </div>
                {isCurrentEditable ? (
                  <div>
                    <label htmlFor="idea-title" className="block text-sm font-medium">Title</label>
                    <input id="idea-title" value={ideaTitle} onChange={(event) => setIdeaTitle(event.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                    <label htmlFor="idea-edit" className="mt-4 block text-sm font-medium">Live File text</label>
                    <textarea ref={ideaTextRef} id="idea-edit" value={ideaDraft} onChange={(event) => { setIdeaDraft(event.target.value); setCurrentVersionNotice(null); }} rows={8} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-sans text-sm leading-relaxed text-foreground outline-none focus:border-emerald-500" />
                  </div>
                ) : (
                  <>
                    <h3 className="text-base font-semibold">{savedTitle}</h3>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{savedText}</pre>
                  </>
                )}
                <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                  {isCurrentEditable ? (
                    <>
                      <button type="button" disabled={isBusy} onClick={() => { setIdeaTitle(savedTitle); setIdeaDraft(savedText); setIsCurrentEditable(false); }} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">Cancel</button>
                      <button type="button" disabled={isBusy || !hasUnsavedEdits} onClick={() => saveIdea("")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{operation?.kind === "save" ? "Saving..." : "Save"}</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => promoteIdea()} disabled={isBusy || hasUnsavedEdits} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">{operation?.kind === "finalize" ? "Creating..." : "Promote to Doc"}</button>
                  )}
                </div>
              </article>
              {timelineItems.map((item) => {
                const isRunning = item.status === "running";
                const isFailed = item.status === "failed";
                const isEditingOption = editingOptionIds.has(item.id);
                const optionText = optionDraftText(item);
                return (
                  <article key={item.id} aria-busy={isRunning} className={`rounded-lg border bg-card p-4 ${isFailed ? "border-red-300 dark:border-red-900" : "border-border"}`}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-foreground">Generated Option</h2>
                        {isRunning ? statusTag("Running", "amber") : isFailed ? statusTag("Failed", "red") : statusTag(`Option ${item.version}`, "neutral")}
                      </div>
                      {!isRunning && !isFailed && (
                        <div className="flex flex-wrap items-center gap-2">
                          {isEditingOption ? (
                            <button type="button" onClick={() => saveOptionEdit(item)} disabled={isBusy || item.turnIndex === undefined || !optionText} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">{operation?.kind === "save" ? "Saving..." : "Save"}</button>
                          ) : (
                            <button type="button" onClick={() => toggleOptionEdit(item)} disabled={isBusy} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">Edit</button>
                          )}
                          <button type="button" onClick={() => saveIdea("Regenerate this generated option.", optionText)} disabled={isBusy || hasUnsavedEdits || !optionText} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">{operation?.kind === "refine" ? "Regenerating..." : "Regenerate"}</button>
                          <button type="button" onClick={() => copyText(optionText, `${item.id}-top`)} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">{copyTarget === `${item.id}-top` ? "Copied" : "Copy"}</button>
                        </div>
                      )}
                    </div>
                    {item.instruction && (
                      <p className="mb-2 text-xs font-medium text-sky-700 dark:text-sky-300">Instruction: {item.instruction}</p>
                    )}
                    {isRunning ? (
                      <div role="status" aria-live="polite" className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                        <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Pitch Builder is generating an option.</span>
                      </div>
                    ) : isFailed ? (
                      <div role="alert" className="rounded-md border border-red-200 bg-red-50/80 px-3 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                        {item.error || "Pitch Builder failed. Try again."}
                      </div>
                    ) : isEditingOption ? (
                      <textarea value={optionDrafts[item.id] ?? item.ideaText} onChange={(event) => setOptionDrafts((current) => ({ ...current, [item.id]: event.target.value }))} rows={8} className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-sans text-sm leading-relaxed text-foreground outline-none focus:border-emerald-500" aria-label="Edit generated option" />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{optionText}</pre>
                    )}
                    {!isRunning && !isFailed && (
                      <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                        <button type="button" onClick={() => promoteIdea(optionText)} disabled={isBusy || hasUnsavedEdits || !optionText} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">{operation?.kind === "finalize" ? "Creating..." : "Promote to Doc"}</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <section className="rounded-lg border border-border bg-card p-4">
              <label htmlFor="idea-instructions" className="block text-sm font-medium">What should change in the next generated option?</label>
              <textarea id="idea-instructions" value={ideaInstructions} onChange={(event) => setIdeaInstructions(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Give feedback for a clean generated option." />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => setStage("premises")} className={secondaryButtonClass}>Ideas</button>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => saveIdea(ideaInstructions)} disabled={isBusy || !ideaInstructions.trim()} className={primaryButtonClass}>{operation?.kind === "refine" ? "Improving..." : "Improve pitch"}</button>
                </div>
              </div>
            </section>
            {(operation?.kind === "save" || operation?.kind === "restore" || operation?.kind === "finalize") && renderOperationCard()}
          </section>
        )}
      </section>
    );
  }

  if (status === "loading" || !session?.user) return <main className="mx-auto max-w-5xl px-6 py-12 text-sm text-muted-foreground">Loading...</main>;

  if (!pitchLabEnabled) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-sm font-medium text-muted-foreground">Pitch Lab is disabled in this environment while the Writer portal and database migration are being verified.</p>
      </main>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
      {renderConfirmDialog()}
      {renderShortlistDialog()}
      <header className="shrink-0 border-b border-border bg-card px-5 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-4 text-sm"><Link href="/" className="font-medium text-foreground hover:text-emerald-600">AI Writer</Link><Link href="/docs" className="text-muted-foreground hover:text-foreground">Docs</Link></div>
            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Pitch Lab</p>
              <h1 className="text-lg font-semibold text-foreground">Build Pilot Pitch</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex rounded-md border border-border bg-muted p-1 text-xs">
              {([
                ["inputs", "Start", true],
                ["premises", "Ideas", premises.length > 0],
                ["pitch", "Shortlist", shortlisted.length > 0],
              ] as [PitchStage, string, boolean][]).map(([item, label, enabled]) => <button key={item} type="button" disabled={!enabled} onClick={() => setStage(item)} className={`min-h-9 rounded px-3 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${stage === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} aria-current={stage === item ? "step" : undefined}>{label}</button>)}
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div ref={mainScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-7xl space-y-4">
          {renderAlerts()}
          {stage === "inputs" && renderInputs()}
          {stage === "premises" && renderStoryDirections()}
          {stage === "pitch" && renderPitchTimeline()}
          </div>
        </div>
      </main>
    </div>
  );
}
