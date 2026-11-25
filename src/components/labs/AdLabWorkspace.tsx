"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { TabRow } from "@/components/editor/TabRail";
import { appendTiptapDocument, buildLocalAdDraft, shouldConfirmNewAd, validateAdDraft } from "@/lib/ad-lab";
import { taggedToTiptapJson } from "@/lib/ai/tagged-tiptap";

type Stage = "inputs" | "draft";
type AdMode = "ad_lab_draft" | "ad_lab_iterate";
type Turn = {
  id: string;
  user: string;
  title: string;
  output: string;
  status: "running" | "complete" | "failed";
  error?: string;
  version: number;
  inputKey: string;
};

interface Props {
  documentId: string;
  tabs: TabRow[];
  modelId: string;
  thinking: boolean;
  onRefreshTabs: () => Promise<TabRow[]>;
  onSaved: (tabId: string) => Promise<void>;
}

async function runModel(
  documentId: string,
  modelId: string,
  thinking: boolean,
  mode: AdMode,
  content: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/ai/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, documentId, modelId, thinking, messages: [{ role: "user", content }] }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "Ad Lab request failed");
  }
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  if (!result.trim()) throw new Error("No output returned.");
  return result;
}

export default function AdLabWorkspace({ documentId, tabs, modelId, thinking, onRefreshTabs, onSaved }: Props) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [stage, setStage] = useState<Stage>("inputs");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [composer, setComposer] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const sessionRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const adsTab = useMemo(() => tabs.find((tab) => tab.type === "ads"), [tabs]);
  const localMode = modelId === "local-sample" || modelId === "";
  const inputKey = `${name.trim()}\n${brief.trim()}`;
  const source = `Ad name: ${name.trim()}\nWriter brief (the only allowed source for B and D):\n${brief.trim() || "No footage supplied yet."}`;
  const completedTurns = turns.filter((turn) => turn.status === "complete");
  const latestCompletedTurn = completedTurns.at(-1);
  const displayTurn = turns.at(-1);
  const latestDraft = latestCompletedTurn?.output ?? "";
  const previousTurns = turns.filter((turn) => turn.id !== displayTurn?.id);
  const inputsChanged = Boolean(latestCompletedTurn && latestCompletedTurn.inputKey !== inputKey);
  const savedCurrentDraft = Boolean(latestDraft && savedDraft === latestDraft && !inputsChanged);

  const execute = async (mode: AdMode, user: string, context: string, localOutput: string, title: string) => {
    const id = crypto.randomUUID();
    const version = completedTurns.length + 1;
    const sessionId = sessionRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    const pending: Turn = { id, user, title, output: "", status: "running", version, inputKey };
    setTurns((current) => [...current, pending]);
    setRunning(true);
    setMessage(null);
    try {
      const output = localMode
        ? localOutput
        : await runModel(documentId, modelId, thinking, mode, context, controller.signal);
      if (sessionRef.current !== sessionId) return null;
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, output, status: "complete" } : turn));
      setSavedDraft(null);
      return output;
    } catch (error) {
      if (controller.signal.aborted || sessionRef.current !== sessionId) return null;
      const errorText = error instanceof Error ? error.message : "Ad Lab failed.";
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, status: "failed", error: errorText } : turn));
      setMessage(errorText);
      return null;
    } finally {
      if (sessionRef.current === sessionId) {
        setRunning(false);
        requestRef.current = null;
      }
    }
  };

  const generateDraft = async () => {
    if (!name.trim()) {
      setMessage("Add an ad name first.");
      return;
    }
    setStage("draft");
    await execute(
      "ad_lab_draft",
      latestDraft ? "Generate a new draft from the updated inputs." : "Generate the first A–B–C–D ad draft.",
      source,
      buildLocalAdDraft(name, brief),
      "Ad Draft Writer",
    );
  };

  const giveFeedback = async () => {
    const feedback = composer.trim();
    if (!feedback || !latestDraft) return;
    setComposer("");
    const localRevision = latestDraft.replace(
      "[P] B — EXISTING FOOTAGE",
      `[UL] (Writer Notes: ${feedback.replace(/[\[\]]/g, "").trim()})\n[P] B — EXISTING FOOTAGE`,
    );
    await execute(
      "ad_lab_iterate",
      feedback,
      `${source}\n\nCurrent draft:\n${latestDraft}\n\nWriter feedback:\n${feedback}`,
      localRevision,
      "Draft Reviser",
    );
  };

  const rerun = async (turn: Turn) => {
    await execute(
      "ad_lab_iterate",
      `Regenerate version ${turn.version} from the current inputs.`,
      `${source}\n\nCurrent draft:\n${turn.output}\n\nReturn a fresh complete draft.`,
      turn.output,
      "Draft Reviser",
    );
  };

  const startNewAd = () => {
    const needsConfirmation = shouldConfirmNewAd({
      running: running || saving,
      hasInput: Boolean(name.trim() || brief.trim()),
      hasDraft: Boolean(latestDraft),
      hasFeedback: Boolean(composer.trim()),
      savedCurrentDraft,
    });
    if (needsConfirmation) {
      const prompt = running || saving
        ? `${running ? "Cancel the current generation" : "Leave while the current save finishes"} and start a new ad? The current Ad Lab work will be cleared.`
        : "Start a new ad? Unsaved Ad Lab work will be cleared.";
      if (!window.confirm(prompt)) return;
    }
    requestRef.current?.abort();
    sessionRef.current += 1;
    requestRef.current = null;
    setName("");
    setBrief("");
    setStage("inputs");
    setTurns([]);
    setComposer("");
    setRunning(false);
    setSaving(false);
    setMessage(null);
    setSavedDraft(null);
    setCopiedTurnId(null);
    window.requestAnimationFrame(() => document.getElementById("ad-lab-name")?.focus());
  };

  const save = async () => {
    const sessionId = sessionRef.current;
    const validity = validateAdDraft(latestDraft);
    if (!validity.ok) {
      setMessage(validity.error ?? "The draft is not ready to save.");
      return;
    }
    if (savedCurrentDraft) {
      setMessage("This draft is already saved to Ads.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const freshTabs = await onRefreshTabs();
      const target = freshTabs.find((tab) => tab.type === "ads") ?? adsTab;
      if (!target) throw new Error("The Series Ads tab is unavailable. Refresh and try again.");
      const currentResponse = await fetch(`/api/documents/${documentId}/tabs/${target.id}/content`);
      if (!currentResponse.ok) throw new Error("Could not load the latest Ads content.");
      const current = await currentResponse.json() as { content: string | null; updatedAt: string };
      const content = appendTiptapDocument(current.content, taggedToTiptapJson(latestDraft));
      const response = await fetch(`/api/documents/${documentId}/tabs/${target.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, baseUpdatedAt: current.updatedAt, forceVersion: true, versionReason: "ad-lab-save" }),
      });
      if (response.status === 409) throw new Error("Ads changed while you were working. Your draft is safe—refresh and save again.");
      if (!response.ok) throw new Error("Could not save this ad.");
      if (sessionRef.current !== sessionId) return;
      setSavedDraft(latestDraft);
      setMessage("Saved to the Series Ads tab.");
      await onSaved(target.id);
    } catch (error) {
      if (sessionRef.current !== sessionId) return;
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      if (sessionRef.current === sessionId) setSaving(false);
    }
  };

  const renderTurn = (turn: Turn, current = false) => (
    <article key={turn.id} className={`rounded-lg border p-4 ${current ? "border-emerald-200 bg-card dark:border-emerald-900" : "border-border bg-background"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{turn.title}</h2>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${turn.status === "running" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200" : turn.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"}`}>
            {turn.status === "running" ? "Running" : turn.status === "failed" ? "Failed" : `v${turn.version}`}
          </span>
        </div>
        {turn.status === "complete" && (
          <div className="flex gap-2">
            <button type="button" disabled={running} onClick={() => void rerun(turn)} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">Regenerate</button>
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(turn.output); setCopiedTurnId(turn.id); }} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">{copiedTurnId === turn.id ? "Copied" : "Copy"}</button>
          </div>
        )}
      </div>
      {turn.user && <p className="mb-3 text-xs text-muted-foreground">{turn.user}</p>}
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{turn.status === "failed" ? `Failed: ${turn.error}` : turn.output || "Working..."}</pre>
    </article>
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Ad Lab</p>
            <h1 className="mt-1 truncate text-base font-semibold text-foreground">{name.trim() || "Build an A–B–C–D Ad"}</h1>
            <p className="mt-1 truncate text-xs text-muted-foreground">A/C are new clips. B/D use only footage you describe.</p>
          </div>
          <button type="button" onClick={startNewAd} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Ad
          </button>
        </div>
      </div>

      {stage === "inputs" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <section className="mx-auto max-w-4xl space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold">Ad inputs</h2>
              <p className="mt-1 text-sm text-muted-foreground">Name the ad and describe the idea plus the exact series footage available for B and D.</p>
            </div>
            <label className="block text-sm font-medium" htmlFor="ad-lab-name">Ad name</label>
            <input id="ad-lab-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. The Door Was Already Open" className="-mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            <label className="block text-sm font-medium" htmlFor="ad-lab-brief">Ad brief</label>
            <textarea id="ad-lab-brief" value={brief} onChange={(event) => setBrief(event.target.value)} rows={12} placeholder="Describe the ad idea and the exact existing series moments available for B and D…" className="-mt-3 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-emerald-500" />
            {inputsChanged && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">Inputs changed. Generate a new version to apply them.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {latestDraft && !inputsChanged && <button type="button" onClick={() => setStage("draft")} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">Back to Draft</button>}
              <button type="button" onClick={() => void generateDraft()} disabled={running} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{running ? "Generating..." : latestDraft ? "Generate New Version" : "Generate Draft"}</button>
            </div>
          </section>
          {message && <Status text={message} />}
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section className="rounded-md border border-border bg-muted/40 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current ad</p><p className="mt-1 text-sm font-medium">{name}</p></div>
                <button type="button" onClick={() => setStage("inputs")} disabled={running} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">Edit inputs</button>
              </div>
            </section>

            {displayTurn ? renderTurn(displayTurn, true) : <section className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">Your draft will appear here.</section>}

            {previousTurns.length > 0 && (
              <details className="rounded-lg border border-border bg-card">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Previous versions ({previousTurns.length})</summary>
                <div className="space-y-3 border-t border-border p-4">{previousTurns.map((turn) => renderTurn(turn))}</div>
              </details>
            )}
            {message && <Status text={message} />}
          </div>

          <div className="border-t border-border bg-card px-6 py-4">
            <div className="mx-auto max-w-6xl">
              <label className="block" htmlFor="ad-lab-feedback"><span className="text-sm font-medium">What should change in the ad draft?</span></label>
              <textarea id="ad-lab-feedback" value={composer} onChange={(event) => setComposer(event.target.value)} disabled={running} placeholder="Example: Make the hook faster and preserve the writer-supplied footage." className="mt-2 h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-60" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => void save()} disabled={saving || running || !latestDraft || savedCurrentDraft} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50">{saving ? "Saving..." : savedCurrentDraft ? "Saved to Ads" : "Save to Ads"}</button>
                <button type="button" onClick={() => void giveFeedback()} disabled={running || !composer.trim() || !latestDraft} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{running ? "Revising..." : "Give Feedback"}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Status({ text }: { text: string }) {
  return <p role="status" className="mx-auto mt-4 max-w-4xl rounded-md border border-border bg-muted px-3 py-2 text-sm">{text}</p>;
}
