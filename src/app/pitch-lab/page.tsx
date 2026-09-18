"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const SAMPLE_TITLE_PREFIX = "[Sample] ";

type Idea = { id: string; title: string; ideaText: string; status: "generated" | "shortlisted" | "discarded" | "promoted"; promotedDocumentId?: string | null; isPlaceholder?: boolean };
type WriterDoc = { id: string; title: string };
type GenerationMode = "framework" | "adaptation";

function displayTitle(title: string) {
  return title.startsWith(SAMPLE_TITLE_PREFIX) ? title.slice(SAMPLE_TITLE_PREFIX.length) : title;
}

function markSampleIdea(idea: Idea): Idea {
  return { ...idea, isPlaceholder: idea.isPlaceholder === true || idea.title.startsWith(SAMPLE_TITLE_PREFIX) };
}

export default function PitchLabPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("framework");
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [pastedSource, setPastedSource] = useState("");
  const [adaptationStyle, setAdaptationStyle] = useState<"close" | "loose">("loose");
  const [docs, setDocs] = useState<WriterDoc[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [instructions, setInstructions] = useState("");
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaInstructions, setIdeaInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"create" | "shortlist">("create");
  const [showGenerator, setShowGenerator] = useState(true);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [sampleNotice, setSampleNotice] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (status === "authenticated") {
      fetch("/api/pitch-lab/workspace").then((r) => r.ok ? r.json() : null).then((data) => {
        if (!data?.workspace) return;
        setBrief(data.workspace.brief ?? "");
        setAdaptationStyle(data.workspace.adaptationStyle ?? "loose");
        const sources = Array.isArray(data.sources) ? data.sources : [];
        const writerSource = sources.find((source: { type: string; sourceDocumentId?: string | null }) => source.type === "writer_doc");
        const pasted = sources.find((source: { type: string }) => source.type === "pasted_text");
        setGenerationMode(sources.length ? "adaptation" : "framework");
        setSourceDocumentId(writerSource?.sourceDocumentId ?? "");
        setPastedSource((pasted?.textSnapshot ?? "").replace(/^Pasted source material:\s*/i, ""));
        const loadedIdeas = Array.isArray(data.ideas) ? data.ideas.map(markSampleIdea) : [];
        setIdeas(loadedIdeas);
        const hasActiveIdeas = loadedIdeas.some((idea: Idea) => idea.status === "generated");
        setShowGenerator(!hasActiveIdeas);
        setSampleNotice(loadedIdeas.some((idea: Idea) => idea.isPlaceholder === true));
      }).catch(() => undefined);
      fetch("/api/documents").then((r) => r.ok ? r.json() : []).then((rows) => {
        if (Array.isArray(rows)) setDocs(rows.map((row) => ({ id: row.id, title: row.title })));
      }).catch(() => setDocs([]));
    }
  }, [router, status]);

  const generated = useMemo(() => ideas.filter((idea) => idea.status === "generated"), [ideas]);
  const shortlisted = useMemo(() => ideas.filter((idea) => idea.status === "shortlisted"), [ideas]);
  const discarded = useMemo(() => ideas.filter((idea) => idea.status === "discarded"), [ideas]);
  const visibleIdeas = useMemo(() => showDiscarded ? [...generated, ...discarded] : generated, [showDiscarded, generated, discarded]);
  const selectedIdea = useMemo(() => shortlisted.find((idea) => idea.id === selectedIdeaId) ?? shortlisted[0] ?? null, [shortlisted, selectedIdeaId]);
  const hasSource = Boolean(sourceDocumentId || pastedSource.trim());

  useEffect(() => {
    setSelectedIdeaId(selectedIdea?.id ?? null);
    setIdeaDraft(selectedIdea?.ideaText ?? "");
    setIdeaTitle(selectedIdea ? displayTitle(selectedIdea.title) : "");
  }, [selectedIdea]);

  async function generate(regenerate = false) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pitch-lab/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationType: generationMode,
          brief,
          sourceDocumentId: generationMode === "adaptation" ? sourceDocumentId || null : null,
          pastedSource: generationMode === "adaptation" ? pastedSource : "",
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
      setSampleNotice(data.isPlaceholder === true || newIdeas.some((idea: Idea) => idea.isPlaceholder === true));
      setInstructions("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate ideas.");
    } finally {
      setLoading(false);
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

  async function saveIdea() {
    if (!selectedIdea) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pitch-lab/ideas/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId: selectedIdea.id, title: ideaTitle, ideaText: ideaDraft, instruction: ideaInstructions }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update idea.");
      setIdeaDraft(data.ideaText);
      const isPlaceholder = selectedIdea.isPlaceholder === true || data.isPlaceholder === true;
      const storedTitle = `${isPlaceholder ? SAMPLE_TITLE_PREFIX : ""}${ideaTitle || displayTitle(selectedIdea.title)}`;
      setIdeas((current) => current.map((idea) => idea.id === selectedIdea.id
        ? { ...idea, title: storedTitle, ideaText: data.ideaText, isPlaceholder }
        : idea));
      setSampleNotice((current) => current || isPlaceholder);
      setIdeaInstructions("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update idea.");
    } finally {
      setLoading(false);
    }
  }

  async function promoteIdea() {
    if (!selectedIdea) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pitch-lab/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId: selectedIdea.id, title: ideaTitle, ideaText: ideaDraft }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not create Writer document.");
      router.push(`/doc/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create Writer document.");
    } finally {
      setLoading(false);
    }
  }

  function openCreateIdeas() {
    setView("create");
    if (!generated.length) setShowGenerator(true);
  }

  if (status === "loading" || !session?.user) return <main className="mx-auto max-w-5xl px-6 py-12 text-sm text-muted-foreground">Loading...</main>;

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
            <button onClick={() => { setSelectedIdeaId(shortlisted[0]?.id ?? null); setView("shortlist"); }} aria-current={view === "shortlist" ? "page" : undefined} className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold ${view === "shortlist" ? "bg-indigo-600 text-white" : "border border-border text-muted-foreground hover:bg-muted"}`}>Shortlisted ideas ({shortlisted.length})</button>
          </nav>
        </div>

        {sampleNotice && <p className="mb-5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">Local sample mode: these placeholder ideas and refinements are for testing the flow. No AI request was made.</p>}
        {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

        {view === "create" && <>
          {generated.length > 0 && <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Ideas to sort</h2>
              <p className="mt-1 text-sm text-muted-foreground">Shortlist ideas to refine them, or discard the ones you do not want to keep.</p>
            </div>
            <button onClick={() => setShowGenerator((open) => !open)} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">{showGenerator ? "Close idea setup" : "Create new ideas"}</button>
          </div>}

          {showGenerator && <section className="mb-8 max-w-3xl rounded-xl border border-border bg-card p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setGenerationMode("framework")} aria-pressed={generationMode === "framework"} className={`rounded-lg border p-4 text-left transition-colors ${generationMode === "framework" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-border hover:bg-muted"}`}>
                <span className="block font-semibold">Generate from the plot framework</span>
                <span className="mt-1 block text-sm text-muted-foreground">Create original pilot ideas using the active framework. Its details stay behind the scenes.</span>
              </button>
              <button type="button" onClick={() => setGenerationMode("adaptation")} aria-pressed={generationMode === "adaptation"} className={`rounded-lg border p-4 text-left transition-colors ${generationMode === "adaptation" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-border hover:bg-muted"}`}>
                <span className="block font-semibold">Adapt an existing story</span>
                <span className="mt-1 block text-sm text-muted-foreground">Choose a Writer doc or paste story material. Close adaptations can keep the same story beats.</span>
              </button>
            </div>

            {generationMode === "framework" ? <div className="mt-6">
              <label htmlFor="pitch-brief" className="block text-sm font-medium">Optional direction</label>
              <textarea id="pitch-brief" value={brief} onChange={(event) => setBrief(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Any tone, genre, or creative direction to steer the ideas? You can leave this blank." />
            </div> : <div className="mt-6 border-t border-border pt-5">
              <label htmlFor="source-document" className="block text-sm font-medium">Choose an existing Writer doc</label>
              <select id="source-document" value={sourceDocumentId} onChange={(event) => setSourceDocumentId(event.target.value)} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select a Writer document</option>
                {docs.map((doc) => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
              </select>
              {docs.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No Writer docs yet. You can paste story material below.</p>}
              <label htmlFor="pasted-source" className="mt-4 block text-sm font-medium">Or paste story material</label>
              <textarea id="pasted-source" value={pastedSource} onChange={(event) => setPastedSource(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Paste a story or plot to adapt..." />
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

            <p className="mt-5 text-sm text-muted-foreground">{generationMode === "framework" ? "The active plot framework guides the ideas without being shown here." : "Choose a Writer doc, paste story material, or use both as adaptation sources."}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={() => generate()} disabled={loading || (generationMode === "adaptation" && !hasSource)} className="min-h-11 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Generating ideas..." : generationMode === "framework" ? "Generate original ideas" : "Generate adapted ideas"}</button>
              {generated.length > 0 && <button onClick={() => setShowGenerator(false)} className="min-h-11 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>}
            </div>
          </section>}

          {visibleIdeas.length > 0 ? <div className="grid gap-4 md:grid-cols-2">
            {visibleIdeas.map((idea) => <article key={idea.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{displayTitle(idea.title)}</h3>
                {idea.isPlaceholder && <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">Sample</span>}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{idea.ideaText}</p>
              <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                {idea.status === "discarded" ? <button onClick={() => setIdeaStatus(idea.id, "generated")} className="min-h-11 px-2 text-sm font-medium text-muted-foreground hover:text-foreground">Restore idea</button> : <>
                  <button onClick={() => setIdeaStatus(idea.id, "shortlisted")} className="min-h-11 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Add to shortlist</button>
                  <button onClick={() => setIdeaStatus(idea.id, "discarded")} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground">Discard idea</button>
                </>}
              </div>
            </article>)}
          </div> : !showGenerator && <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold">No ideas to sort right now</h2>
            <p className="mt-2 text-sm text-muted-foreground">Shortlisted ideas are in your shortlist. Create more ideas here whenever you are ready.</p>
            <button onClick={() => setShowGenerator(true)} className="mt-4 min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Create new ideas</button>
          </section>}

          {generated.length > 0 && <div className="mt-8 max-w-3xl border-t border-border pt-6">
            <label htmlFor="regeneration-instructions" className="block text-sm font-medium">Optional instructions for the next ideas</label>
            <textarea id="regeneration-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Add a direction for the next ideas, or leave this blank." />
            <p className="mt-2 text-sm text-muted-foreground">Regenerating replaces ideas that have not been shortlisted. Your shortlist and discarded ideas stay available.</p>
            <button onClick={() => generate(true)} disabled={loading || (generationMode === "adaptation" && !hasSource)} className="mt-3 min-h-11 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">{loading ? "Generating ideas..." : "Regenerate ideas"}</button>
          </div>}

          {discarded.length > 0 && <button onClick={() => setShowDiscarded((show) => !show)} className="mt-6 min-h-11 px-1 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground">{showDiscarded ? "Hide discarded ideas" : `View discarded ideas (${discarded.length})`}</button>}
        </>}

        {view === "shortlist" && <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside>
            <div className="space-y-2">{shortlisted.map((idea) => <button key={idea.id} onClick={() => setSelectedIdeaId(idea.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedIdea?.id === idea.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "border-border bg-card hover:bg-muted"}`}>
              <span className="flex items-center justify-between gap-2"><span>{displayTitle(idea.title)}</span>{idea.isPlaceholder && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">Sample</span>}</span>
            </button>)}</div>
          </aside>
          {selectedIdea ? <section className="rounded-xl border border-border bg-card p-5">
            <label htmlFor="idea-title" className="block text-sm font-medium">Pilot idea title</label>
            <input id="idea-title" value={ideaTitle} onChange={(event) => setIdeaTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <label htmlFor="idea-edit" className="mt-4 block text-sm font-medium">Pilot idea</label>
            <textarea id="idea-edit" value={ideaDraft} onChange={(event) => setIdeaDraft(event.target.value)} rows={12} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" />
            {selectedIdea.isPlaceholder && <p className="mt-3 text-sm text-muted-foreground">This sample is for local flow testing. You can edit the plot directly or try a sample iteration below.</p>}
            <label htmlFor="idea-instructions" className="mt-5 block text-sm font-medium">Instructions for refining this idea</label>
            <textarea id="idea-instructions" value={ideaInstructions} onChange={(event) => setIdeaInstructions(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Describe what you want to change. Leave blank to save your edits as written." />
            <div className="mt-4 flex flex-wrap gap-3">
              <button onClick={saveIdea} disabled={loading} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">{loading ? ideaInstructions.trim() ? "Refining idea..." : "Saving edits..." : ideaInstructions.trim() ? "Refine and save idea" : "Save idea edits"}</button>
              <button onClick={promoteIdea} disabled={loading} className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Creating Writer document..." : "Finalize as Writer doc"}</button>
              <button onClick={() => setIdeaStatus(selectedIdea.id, "discarded")} disabled={loading} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground">Reject idea</button>
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
