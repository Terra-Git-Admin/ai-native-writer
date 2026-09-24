"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { parsePitchIdeaEnvelope } from "@/lib/pitch-lab-idea-envelope";
import { isPitchLabEnabledForClient } from "@/lib/pitch-lab-flags";

const SAMPLE_TITLE_PREFIX = "[Sample] ";

type Idea = { id: string; title: string; ideaText: string; status: "generated" | "shortlisted" | "discarded" | "promoted"; promotedDocumentId?: string | null; isPlaceholder?: boolean };
type WriterDoc = { id: string; title: string; ownerName?: string | null };
type GenerationMode = "framework" | "adaptation";
type OperationKind = "generate" | "regenerate" | "refine" | "save" | "restore" | "finalize";
type OperationState = { kind: OperationKind; startedAt: number };
type Notice = { tone: "success" | "info"; title: string; body?: string };

const OPERATION_COPY: Record<OperationKind, { label: string; stages: string[]; slowHint: string }> = {
  generate: {
    label: "Generating pilot ideas",
    stages: ["Reading source and Taste Brief", "Drafting 4 pitch plots", "Checking titles and JSON", "Saving ideas to Pitch Lab"],
    slowHint: "Real AI generation can take 45-90 seconds with larger source material.",
  },
  regenerate: {
    label: "Regenerating ideas",
    stages: ["Reading your new direction", "Drafting replacement ideas", "Checking titles and JSON", "Saving the new set"],
    slowHint: "Regeneration waits for the full model response before replacing ideas.",
  },
  refine: {
    label: "Refining current idea",
    stages: ["Reading current version", "Applying refinement direction", "Validating title and plot", "Saving version history"],
    slowHint: "Refine uses the AI model when real-AI mode is enabled, so it can take a minute.",
  },
  save: {
    label: "Saving manual edits",
    stages: ["Reading edits", "Updating current version", "Saving version state"],
    slowHint: "This is usually quick; if it waits, the local database may be busy.",
  },
  restore: {
    label: "Restoring version",
    stages: ["Loading selected version", "Replacing current version", "Saving restored text"],
    slowHint: "This is usually quick; if it waits, the local database may be busy.",
  },
  finalize: {
    label: "Creating Writer doc",
    stages: ["Preparing current version", "Creating canonical Writer tabs", "Copying plot into Microdrama Plots", "Opening the document"],
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
  return parsePitchIdeaEnvelope(idea.ideaText).currentText;
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

export default function PitchLabPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
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
  const [instructions, setInstructions] = useState("");
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaInstructions, setIdeaInstructions] = useState("");
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [view, setView] = useState<"create" | "shortlist">("create");
  const [showGenerator, setShowGenerator] = useState(true);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [currentVersionNotice, setCurrentVersionNotice] = useState<string | null>(null);
  const [isCurrentEditable, setIsCurrentEditable] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const ideaTextRef = useRef<HTMLTextAreaElement | null>(null);
  const pitchLabEnabled = isPitchLabEnabledForClient();
  const isBusy = Boolean(operation);

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

  function startOperation(kind: OperationKind) {
    setOperation({ kind, startedAt: Date.now() });
    setElapsedSeconds(0);
    setError(null);
    setNotice(null);
  }

  function finishOperation(noticeValue?: Notice) {
    setOperation(null);
    if (noticeValue) setNotice(noticeValue);
  }

  function failOperation(message: string) {
    setOperation(null);
    setNotice(null);
    setError(message);
  }

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (!pitchLabEnabled) return;
    if (status === "authenticated") {
      fetch("/api/pitch-lab/workspace").then((r) => r.ok ? r.json() : null).then((data) => {
        if (!data?.workspace) return;
        setBrief(data.workspace.brief ?? "");
        setAdaptationStyle(data.workspace.adaptationStyle ?? "loose");
        const sources = Array.isArray(data.sources) ? data.sources : [];
        const writerSource = sources.find((source: { type: string; sourceDocumentId?: string | null }) => source.type === "writer_doc");
        const pasted = sources.find((source: { type: string; textSnapshot?: string }) => source.type === "pasted_text" && !source.textSnapshot?.startsWith("Source URL:"));
        const external = sources.find((source: { type: string; textSnapshot?: string }) => source.type === "pasted_text" && source.textSnapshot?.startsWith("Source URL:"));
        setGenerationMode(sources.length ? "adaptation" : "framework");
        setSourceDocumentId(writerSource?.sourceDocumentId ?? "");
        setPastedSource((pasted?.textSnapshot ?? "").replace(/^Pasted source material:\s*/i, ""));
        setSourceUrl((external?.textSnapshot ?? "").match(/^Source URL:\s*(\S+)/m)?.[1] ?? "");
        const loadedIdeas = Array.isArray(data.ideas) ? data.ideas.map(markSampleIdea) : [];
        setIdeas(loadedIdeas);
        setShowGenerator(true);
      }).catch(() => undefined);
      fetch("/api/documents").then((r) => r.ok ? r.json() : []).then((rows) => {
        if (Array.isArray(rows)) setDocs(rows.map((row) => ({ id: row.id, title: row.title, ownerName: row.ownerName ?? null })));
      }).catch(() => setDocs([])).finally(() => setDocsLoading(false));
    }
  }, [pitchLabEnabled, router, status]);

  const generated = useMemo(() => ideas.filter((idea) => idea.status === "generated"), [ideas]);
  const shortlisted = useMemo(() => ideas.filter((idea) => idea.status === "shortlisted"), [ideas]);
  const discarded = useMemo(() => ideas.filter((idea) => idea.status === "discarded"), [ideas]);
  const visibleIdeas = useMemo(() => showDiscarded ? [...generated, ...discarded] : generated, [showDiscarded, generated, discarded]);
  const selectedIdea = useMemo(() => shortlisted.find((idea) => idea.id === selectedIdeaId) ?? shortlisted[0] ?? null, [shortlisted, selectedIdeaId]);
  const selectedEnvelope = useMemo(() => selectedIdea ? parsePitchIdeaEnvelope(selectedIdea.ideaText) : null, [selectedIdea]);
  const historyItems = useMemo(() => selectedEnvelope ? [
    { id: "original", label: "Original", instruction: "Original shortlisted idea", ideaText: selectedEnvelope.originalText },
    ...selectedEnvelope.turns.map((turn, index) => ({ id: `${turn.createdAt || "version"}-${index}`, label: `Version ${index + 1}`, instruction: turn.instruction || "Manual edit", ideaText: turn.ideaText })),
  ] : [], [selectedEnvelope]);
  const hasSource = Boolean(sourceDocumentId || pastedSource.trim() || sourceUrl.trim());
  const filteredDocs = useMemo(() => {
    const query = docSearch.trim().toLocaleLowerCase();
    return query ? docs.filter((doc) => `${doc.title} ${doc.ownerName ?? ""}`.toLocaleLowerCase().includes(query)) : docs;
  }, [docs, docSearch]);
  const selectedSource = docs.find((doc) => doc.id === sourceDocumentId);
  const sourceSummary = generationMode === "framework"
    ? "Framework: active S1-S6 microdrama strategy"
    : selectedSource?.title
      ? `Adapt: ${selectedSource.title}`
      : pastedSource.trim()
        ? "Adapt: pasted story material"
        : sourceUrl.trim()
          ? "Adapt: public story link"
          : "Adapt: choose a source";
  const shortlistSourceLabel = generationMode === "framework"
    ? "New Story"
    : selectedSource?.title
      ? `Adapted from ${selectedSource.title}`
      : pastedSource.trim()
        ? "Adapted from pasted story material"
        : sourceUrl.trim()
          ? "Adapted from public story link"
          : "Adapted from source";
  const savedTitle = selectedIdea ? displayTitle(selectedIdea.title) : "";
  const savedText = selectedEnvelope?.currentText ?? "";
  const hasUnsavedEdits = Boolean(selectedIdea && (ideaTitle.trim() !== savedTitle.trim() || ideaDraft.trim() !== savedText.trim()));
  const operationCopy = operation ? OPERATION_COPY[operation.kind] : null;
  const currentStageIndex = operationCopy ? stageIndexForElapsed(elapsedSeconds, operationCopy.stages.length) : 0;

  useEffect(() => {
    setSelectedIdeaId(selectedIdea?.id ?? null);
    setIdeaDraft(selectedEnvelope?.currentText ?? "");
    setIdeaTitle(selectedIdea ? displayTitle(selectedIdea.title) : "");
    setIdeaInstructions("");
    setShowFinalizeConfirm(false);
    setCurrentVersionNotice(null);
    setIsCurrentEditable(false);
    setShowVersionHistory(false);
  }, [selectedIdea, selectedEnvelope]);

  useEffect(() => {
    if (view === "shortlist" && shortlisted.length === 0) {
      setView("create");
      if (generated.length === 0) setShowGenerator(true);
    }
  }, [generated.length, shortlisted.length, view]);

  async function generate(regenerate = false) {
    startOperation(regenerate ? "regenerate" : "generate");
    try {
      const response = await fetch("/api/pitch-lab/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationType: generationMode,
          brief,
          sourceDocumentId: generationMode === "adaptation" ? sourceDocumentId || null : null,
          pastedSource: generationMode === "adaptation" ? pastedSource : "",
          sourceUrl: generationMode === "adaptation" ? sourceUrl : "",
          adaptationStyle: generationMode === "adaptation" && hasSource ? adaptationStyle : null,
          instruction: regenerate ? instructions : "",
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `Generation failed (${response.status}).`);
      const newIdeas = Array.isArray(data.ideas) ? data.ideas.map((idea: Idea) => markSampleIdea(idea)) : [];
      setIdeas((current) => [
        ...current.filter((idea) => idea.status === "shortlisted" || idea.status === "promoted" || idea.status === "discarded"),
        ...newIdeas,
      ]);
      setView("create");
      setShowGenerator(false);
      setShowDiscarded(false);
      setInstructions("");
      finishOperation({
        tone: "success",
        title: regenerate ? "New ideas are ready" : `${newIdeas.length} pilot ideas are ready`,
        body: "Review the cards below and shortlist the strongest candidates.",
      });
    } catch (err) {
      failOperation(err instanceof Error ? err.message : "Could not generate ideas.");
    }
  }

  async function setIdeaStatus(id: string, next: Exclude<Idea["status"], "promoted">) {
    setError(null);
    try {
      const response = await fetch(`/api/pitch-lab/ideas/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update idea.");
      setIdeas((current) => current.map((idea) => idea.id === id ? { ...idea, status: next } : idea));
      if (next !== "generated" && generated.length <= 1) setShowGenerator(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update idea.");
      return false;
    }
  }

  async function saveIdea(instructionOverride = ideaInstructions) {
    if (!selectedIdea) return;
    const instruction = instructionOverride.trim();
    startOperation(instruction ? "refine" : "save");
    try {
      const response = await fetch("/api/pitch-lab/ideas/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId: selectedIdea.id, title: ideaTitle, ideaText: ideaDraft, instruction }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update idea.");
      const currentText = typeof data?.currentText === "string" ? data.currentText : parsePitchIdeaEnvelope(data.ideaText ?? "").currentText;
      const cleanTitle = typeof data?.title === "string" ? data.title : ideaTitle || displayTitle(selectedIdea.title);
      setIdeaDraft(currentText);
      setIdeaTitle(cleanTitle);
      const isPlaceholder = selectedIdea.isPlaceholder === true || data.isPlaceholder === true;
      setIdeas((current) => current.map((idea) => idea.id === selectedIdea.id
        ? { ...idea, title: cleanTitle, ideaText: data.ideaText, isPlaceholder }
        : idea));
      if (instruction) {
        setIdeaInstructions("");
        setCurrentVersionNotice("New current version generated. Review it, then click Edit if you want to change it manually.");
        setIsCurrentEditable(false);
        finishOperation({
          tone: "success",
          title: "Refined version is ready",
          body: "The Current version has been replaced. Review the highlighted Current version before finalizing.",
        });
      } else {
        setCurrentVersionNotice("Manual edits saved to the Current version.");
        setIsCurrentEditable(false);
        finishOperation({
          tone: "success",
          title: "Manual edits saved",
          body: "The Current version now includes your edits.",
        });
      }
    } catch (err) {
      failOperation(err instanceof Error ? err.message : "Could not update idea.");
    }
  }

  async function restoreSnapshot(ideaText: string) {
    if (!selectedIdea) return;
    startOperation("restore");
    try {
      const response = await fetch("/api/pitch-lab/ideas/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId: selectedIdea.id, title: ideaTitle, ideaText, instruction: "" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not restore idea.");
      const currentText = typeof data?.currentText === "string" ? data.currentText : parsePitchIdeaEnvelope(data.ideaText ?? "").currentText;
      const cleanTitle = typeof data?.title === "string" ? data.title : ideaTitle || displayTitle(selectedIdea.title);
      setIdeaDraft(currentText);
      setIdeaTitle(cleanTitle);
      const isPlaceholder = selectedIdea.isPlaceholder === true || data.isPlaceholder === true;
      setIdeas((current) => current.map((idea) => idea.id === selectedIdea.id
        ? { ...idea, title: cleanTitle, ideaText: data.ideaText, isPlaceholder }
        : idea));
      setCurrentVersionNotice("Restored text is now the Current version. Review it, then click Edit if you want to change it manually.");
      setIsCurrentEditable(false);
      finishOperation({
        tone: "success",
        title: "Version restored",
        body: "The restored text is now the Current version.",
      });
    } catch (err) {
      failOperation(err instanceof Error ? err.message : "Could not restore idea.");
    }
  }

  async function promoteIdea() {
    if (!selectedIdea) return;
    if (hasUnsavedEdits) {
      setError("Save or discard edits before finalizing.");
      setNotice(null);
      setShowFinalizeConfirm(false);
      return;
    }
    startOperation("finalize");
    try {
      const response = await fetch("/api/pitch-lab/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId: selectedIdea.id, title: ideaTitle }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not create Writer document.");
      finishOperation({
        tone: "success",
        title: "Writer doc created",
        body: "Opening the finalized document now.",
      });
      router.push(`/doc/${data.id}`);
    } catch (err) {
      failOperation(err instanceof Error ? err.message : "Could not create Writer document.");
    }
  }

  function requestFinalize() {
    if (hasUnsavedEdits) {
      setError("Save or discard edits before finalizing.");
      setNotice(null);
      setShowFinalizeConfirm(false);
      return;
    }
    setError(null);
    setNotice({
      tone: "info",
      title: "Ready to finalize",
      body: "Confirm below to create a Writer document from the Current version.",
    });
    setShowFinalizeConfirm(true);
  }

  function openCreateIdeas() {
    setView("create");
    if (!generated.length) setShowGenerator(true);
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
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-bold">AI Writer</Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="text-muted-foreground hover:text-foreground">Home</Link>
              <Link href="/docs" className="text-muted-foreground hover:text-foreground">View docs</Link>
              <span className="font-medium text-foreground">Pitch Lab</span>
            </nav>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <p className="text-sm font-medium text-indigo-600">Pitch Lab</p>
          <h1 className="mt-1 text-2xl font-semibold">{view === "create" ? "Create pilot ideas" : "Shortlisted ideas"}</h1>
          <nav aria-label="Pitch Lab sections" className="mt-5 flex flex-wrap items-center gap-2 border-b border-border pb-3">
            <button onClick={openCreateIdeas} aria-current={view === "create" ? "page" : undefined} className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold ${view === "create" ? "bg-indigo-600 text-white" : "border border-border text-muted-foreground hover:bg-muted"}`}>Create ideas</button>
            <button onClick={() => { if (shortlisted.length > 0) { setSelectedIdeaId(shortlisted[0].id); setView("shortlist"); } }} disabled={shortlisted.length === 0} aria-current={view === "shortlist" ? "page" : undefined} className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${view === "shortlist" ? "bg-indigo-600 text-white" : "border border-border text-muted-foreground hover:bg-muted"}`}>Shortlisted ideas ({shortlisted.length})</button>
          </nav>
        </div>

        {operation && operationCopy && <div role="status" aria-live="polite" aria-busy="true" className="mb-5 rounded-xl border border-indigo-300 bg-indigo-50 p-4 text-indigo-950 shadow-sm dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{operationCopy.label}</p>
              <p className="mt-1 text-sm text-indigo-800 dark:text-indigo-200">Elapsed {formatElapsed(elapsedSeconds)}. {elapsedSeconds >= 45 ? operationCopy.slowHint : "The page will update when the result is saved."}</p>
            </div>
            <span className="rounded-full border border-indigo-300 bg-white px-3 py-1 text-xs font-semibold text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100">{formatElapsed(elapsedSeconds)}</span>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {operationCopy.stages.map((stage, index) => {
              const isCurrent = index === currentStageIndex;
              const isDone = index < currentStageIndex;
              return <li key={stage} className={`rounded-lg border px-3 py-2 text-xs font-medium ${isCurrent ? "border-indigo-500 bg-white text-indigo-950 dark:bg-indigo-950 dark:text-indigo-100" : isDone ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-indigo-200 bg-indigo-100/50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-300"}`}>
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">{isDone ? "OK" : index + 1}</span>
                {stage}
              </li>;
            })}
          </ol>
        </div>}

        {notice && !operation && <div role="status" aria-live="polite" className={`mb-5 rounded-xl border px-4 py-3 text-sm shadow-sm ${notice.tone === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"}`}>
          <p className="font-semibold">{notice.title}</p>
          {notice.body && <p className="mt-1">{notice.body}</p>}
        </div>}

        {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

        {view === "create" && <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Step 1</p>
                <h2 className="mt-1 text-lg font-semibold">Create ideas</h2>
                <p className="mt-1 text-sm text-muted-foreground">Generate original pilot ideas from the framework, or adapt an existing story.</p>
              </div>
              {generated.length > 0 && <button onClick={() => setShowGenerator((open) => !open)} aria-expanded={showGenerator} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">{showGenerator ? "Collapse" : "Expand"}</button>}
            </div>

            {!showGenerator && <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium">{sourceSummary}</p>
              <p className="mt-1 text-sm text-muted-foreground">Idea setup is collapsed. Expand this section to change the source, mode, or direction.</p>
            </div>}

            {showGenerator && <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={() => setGenerationMode("framework")} aria-pressed={generationMode === "framework"} className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${generationMode === "framework" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-border hover:bg-muted"}`}>
                  <span className="block font-semibold">From framework</span>
                  <span className="mt-1 block text-sm text-muted-foreground">Create original pilot ideas using the active S1-S6 microdrama strategy.</span>
                </button>
                <button type="button" onClick={() => setGenerationMode("adaptation")} aria-pressed={generationMode === "adaptation"} className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${generationMode === "adaptation" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-border hover:bg-muted"}`}>
                  <span className="block font-semibold">Adapt story</span>
                  <span className="mt-1 block text-sm text-muted-foreground">Choose a Writer doc, paste story material, or use a public story link.</span>
                </button>
              </div>

              {generationMode === "framework" ? <div className="mt-6">
                <label htmlFor="pitch-brief" className="block text-sm font-medium">Optional direction</label>
                <textarea id="pitch-brief" value={brief} onChange={(event) => setBrief(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Any tone, genre, or creative direction to steer the ideas? You can leave this blank." />
              </div> : <div className="mt-6 border-t border-border pt-5">
                <label htmlFor="source-document-search" className="block text-sm font-medium">Search all Writer docs</label>
                <div className="relative mt-2">
                  <div className="flex min-h-11 items-center rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                    {selectedSource && !docDropdownOpen && <span aria-hidden="true" className="pl-3 text-indigo-600">✓</span>}
                    <input id="source-document-search" type="search" role="combobox" value={docDropdownOpen ? docSearch : selectedSource?.title ?? docSearch} onFocus={() => { setDocSearch(""); setDocDropdownOpen(true); }} onBlur={() => setDocDropdownOpen(false)} onChange={(event) => { setDocSearch(event.target.value); setSourceDocumentId(""); setDocDropdownOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setDocDropdownOpen(false); }} className="w-full bg-transparent px-3 py-2 text-sm outline-none" placeholder={selectedSource && !docDropdownOpen ? selectedSource.title : "Search by story title or owner..."} aria-controls="source-document-results" aria-expanded={docDropdownOpen} aria-haspopup="listbox" aria-autocomplete="list" autoComplete="off" />
                    {selectedSource && !docDropdownOpen && <span className="mr-3 shrink-0 text-xs font-medium text-indigo-700 dark:text-indigo-300">Selected</span>}
                  </div>
                  {docDropdownOpen && <div id="source-document-results" role="listbox" aria-label="All Writer docs" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                    {docsLoading ? <p className="px-3 py-3 text-sm text-muted-foreground">Loading all Writer docs...</p> : filteredDocs.length ? filteredDocs.map((doc) => <button type="button" role="option" aria-selected={doc.id === sourceDocumentId} key={doc.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSourceDocumentId(doc.id); setDocSearch(doc.title); setDocDropdownOpen(false); }} className={`flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted ${doc.id === sourceDocumentId ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}><span className="font-medium">{doc.title}</span><span className="shrink-0 text-xs text-muted-foreground">{doc.id === sourceDocumentId ? "Selected - " : ""}{doc.ownerName || "Unknown owner"}</span></button>) : <p className="px-3 py-3 text-sm text-muted-foreground">{docs.length ? "No Writer docs match that search." : "No Writer docs yet. You can paste story material below."}</p>}
                  </div>}
                </div>
                <label htmlFor="pasted-source" className="mt-4 block text-sm font-medium">Or paste story material</label>
                <textarea id="pasted-source" value={pastedSource} onChange={(event) => setPastedSource(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Paste a story or plot to adapt..." />
                <label htmlFor="external-story-url" className="mt-4 block text-sm font-medium">Or adapt from a public story link</label>
                <input id="external-story-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="https://www.imdb.com/title/.../" />
                <p className="mt-1 text-xs text-muted-foreground">Pitch Lab reads publicly available page text. Some sites block access or hide their synopsis; if that happens, paste the story details above.</p>
                {hasSource && <fieldset className="mt-5">
                  <legend className="text-sm font-medium">How closely should the adaptation follow the source?</legend>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <label className="flex flex-1 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                      <input type="radio" name="adaptation-style" checked={adaptationStyle === "close"} onChange={() => setAdaptationStyle("close")} className="mt-1" />
                      <span><strong>Close adaptation</strong><span className="mt-1 block text-muted-foreground">Keep the story spine while changing characters, professions, locations, and surface details.</span></span>
                    </label>
                    <label className="flex flex-1 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                      <input type="radio" name="adaptation-style" checked={adaptationStyle === "loose"} onChange={() => setAdaptationStyle("loose")} className="mt-1" />
                      <span><strong>Loose adaptation</strong><span className="mt-1 block text-muted-foreground">Keep the useful story engine and change more of the setup and events.</span></span>
                    </label>
                  </div>
                </fieldset>}
                <label htmlFor="pitch-brief-adaptation" className="mt-5 block text-sm font-medium">Optional direction</label>
                <textarea id="pitch-brief-adaptation" value={brief} onChange={(event) => setBrief(event.target.value)} rows={2} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Any changes you want across the adaptations?" />
              </div>}

              <p className="mt-5 text-sm text-muted-foreground">{generationMode === "framework" ? "The active plot framework guides the ideas without being shown here." : "Choose at least one source before generating adapted ideas."}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button onClick={() => generate()} disabled={isBusy || (generationMode === "adaptation" && !hasSource)} className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">{operation?.kind === "generate" ? "Generating..." : "Generate"}</button>
                {generated.length > 0 && <button onClick={() => setShowGenerator(false)} className="min-h-11 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>}
              </div>
            </>}
          </section>

          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Step 2</p>
              <h2 className="mt-1 text-lg font-semibold">Review generated ideas</h2>
              <p className="mt-1 text-sm text-muted-foreground">Shortlist the ideas worth improving. Discard removes an idea from this review list.</p>
            </div>

            {visibleIdeas.length > 0 ? <div className="mt-5 grid gap-4 md:grid-cols-2">
              {visibleIdeas.map((idea) => <article key={idea.id} className="rounded-xl border border-border bg-background p-5">
                <h3 className="font-semibold">{displayTitle(idea.title)}</h3>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{currentIdeaText(idea)}</p>
                <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                  {idea.status === "discarded" ? <button onClick={() => setIdeaStatus(idea.id, "generated")} className="min-h-11 px-2 text-sm font-medium text-muted-foreground hover:text-foreground">Restore</button> : <>
                    <button onClick={() => setIdeaStatus(idea.id, "shortlisted")} className="min-h-11 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Shortlist</button>
                    <button onClick={() => setIdeaStatus(idea.id, "discarded")} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Discard</button>
                  </>}
                </div>
              </article>)}
            </div> : <div className="mt-5 rounded-lg border border-dashed border-border p-5">
              <h3 className="font-semibold">No ideas waiting for review</h3>
              <p className="mt-2 text-sm text-muted-foreground">Generate ideas in Step 1. Shortlisted ideas stay saved in Step 3.</p>
              {!showGenerator && <button onClick={() => setShowGenerator(true)} className="mt-4 min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Create</button>}
            </div>}

            {generated.length > 0 && <div className="mt-6 border-t border-border pt-5">
              <label htmlFor="regeneration-instructions" className="block text-sm font-medium">Optional instructions for the next ideas</label>
              <textarea id="regeneration-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Add a direction for the next ideas, or leave this blank." />
              <p className="mt-2 text-sm text-muted-foreground">Regenerating replaces ideas that have not been shortlisted. Your shortlist and discarded ideas stay available.</p>
              <button onClick={() => generate(true)} disabled={isBusy || (generationMode === "adaptation" && !hasSource)} className="mt-3 min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50">{operation?.kind === "regenerate" ? "Regenerating..." : "Regenerate"}</button>
            </div>}
            {discarded.length > 0 && <button onClick={() => setShowDiscarded((show) => !show)} className="mt-5 min-h-11 px-1 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground">{showDiscarded ? "Hide discarded ideas" : `View discarded ideas (${discarded.length})`}</button>}
          </section>

          <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Step 3</p>
                <h2 className="mt-1 text-lg font-semibold">Shortlist</h2>
                <p className="mt-1 text-sm text-muted-foreground">{shortlisted.length ? `${shortlisted.length} idea${shortlisted.length === 1 ? "" : "s"} ready to refine, finalize, or reject.` : "Shortlisted ideas appear here after you choose them in Step 2."}</p>
              </div>
              <button onClick={() => { setSelectedIdeaId(shortlisted[0]?.id ?? null); setView("shortlist"); }} disabled={shortlisted.length === 0} className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">Open</button>
            </div>
          </section>
        </div>}

        {view === "shortlist" && <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside>
            <div className="space-y-2">{shortlisted.map((idea) => <button key={idea.id} onClick={() => setSelectedIdeaId(idea.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedIdea?.id === idea.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-border bg-card hover:bg-muted"}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{displayTitle(idea.title)}</span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{shortlistSourceLabel}</span>
            </button>)}</div>
          </aside>
          {selectedIdea ? <section className="space-y-5">
            <div className="rounded-xl border-2 border-indigo-500 bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Current version</p>
                    {!isCurrentEditable && <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">Generated current</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Refined output replaces this Current version. Finalize creates a Writer doc from this version only.</p>
                </div>
                {!isCurrentEditable && <button type="button" onClick={() => { setIsCurrentEditable(true); requestAnimationFrame(() => ideaTextRef.current?.focus()); }} className="min-h-10 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">Edit</button>}
              </div>
              {currentVersionNotice && <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{currentVersionNotice}</p>}
              <label htmlFor="idea-title" className="mt-4 block text-sm font-medium">Title</label>
              <input id="idea-title" value={ideaTitle} onChange={(event) => setIdeaTitle(event.target.value)} readOnly={!isCurrentEditable} className={`mt-2 w-full rounded-lg border border-input px-3 py-2 text-sm ${isCurrentEditable ? "bg-background" : "bg-muted/40 text-muted-foreground"}`} />
              <label htmlFor="idea-edit" className="mt-4 block text-sm font-medium">Current idea text</label>
              <textarea ref={ideaTextRef} id="idea-edit" value={ideaDraft} onChange={(event) => { setIdeaDraft(event.target.value); setCurrentVersionNotice(null); }} readOnly={!isCurrentEditable} rows={8} className={`mt-2 w-full rounded-lg border border-input px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring ${isCurrentEditable ? "bg-background" : "bg-muted/40 text-muted-foreground"}`} />
              <div className="mt-5 border-t border-border pt-5">
              <label htmlFor="idea-instructions" className="block text-sm font-medium">Refine the current text</label>
              <textarea id="idea-instructions" value={ideaInstructions} onChange={(event) => setIdeaInstructions(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Example: make the betrayal sharper and keep the ending as a cliffhanger." />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button onClick={() => saveIdea(ideaInstructions)} disabled={isBusy || !ideaInstructions.trim()} className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{operation?.kind === "refine" ? "Refining..." : "Refine"}</button>
                <span className="text-sm text-muted-foreground">Refine uses the current text above, including unsaved edits, and replaces it with the new version.</span>
              </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Manual edits and final actions</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Use these only after the Current version reads the way you want.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => saveIdea("")} disabled={isBusy || !hasUnsavedEdits} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{operation?.kind === "save" ? "Saving..." : "Save edits"}</button>
                  {hasUnsavedEdits && <button onClick={() => { setIdeaTitle(savedTitle); setIdeaDraft(savedText); setIsCurrentEditable(false); }} disabled={isBusy} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">Discard edits</button>}
                  <button onClick={() => setIdeaStatus(selectedIdea.id, "discarded")} disabled={isBusy} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">Reject</button>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Ready to create a Writer doc?</p>
                    <p className="mt-1 text-xs text-muted-foreground">Finalize creates a Writer doc from Current version only. Iteration history is not copied.</p>
                    {hasUnsavedEdits && <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">Save or discard edits before finalizing.</p>}
                  </div>
                  <button onClick={requestFinalize} disabled={isBusy || hasUnsavedEdits} className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Finalize</button>
                </div>
                {showFinalizeConfirm && <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Confirm Writer doc creation</p>
                  <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-200">This will create a Writer doc titled <span className="font-medium">{ideaTitle || savedTitle}</span> using only the Current version text above. No iteration history or older turns will be included.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button onClick={promoteIdea} disabled={isBusy} className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{operation?.kind === "finalize" ? "Creating doc..." : "Yes, create Writer doc"}</button>
                    <button onClick={() => setShowFinalizeConfirm(false)} disabled={isBusy} className="min-h-11 rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-950/60">Cancel</button>
                  </div>
                </div>}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/70 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Previous versions ({historyItems.length})</h2>
                  <p className="mt-1 text-sm text-muted-foreground">These are backups. Finalize ignores them unless you restore one first.</p>
                </div>
                <button type="button" onClick={() => setShowVersionHistory((show) => !show)} className="min-h-10 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500" aria-expanded={showVersionHistory}>{showVersionHistory ? "Hide versions" : "Show versions"}</button>
              </div>
              {showVersionHistory && <div className="mt-4 space-y-3">
                {historyItems.map((item) => {
                  const isCurrent = item.ideaText.trim() === savedText.trim();
                  return <article key={item.id} className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.instruction}</p>
                      </div>
                      <button onClick={() => restoreSnapshot(item.ideaText)} disabled={isBusy || isCurrent} className="min-h-9 rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-background disabled:cursor-not-allowed disabled:opacity-50">{operation?.kind === "restore" && !isCurrent ? "Restoring..." : isCurrent ? "Current" : "Restore"}</button>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap leading-6 text-muted-foreground">{item.ideaText}</p>
                  </article>;
                })}
              </div>}
            </div>
          </section> : <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold">No ideas shortlisted yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Add an idea from Create ideas to refine it or finalize it as a Writer doc.</p>
            <button onClick={openCreateIdeas} className="mt-4 min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Create pilot ideas</button>
          </section>}
        </div>}
      </main>
    </div>
  );
}
