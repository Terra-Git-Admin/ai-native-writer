"use client";

import { useMemo, useState } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import { appendTiptapDocument, buildLocalAdDraft, validateAdDraft } from "@/lib/ad-lab";
import { taggedToTiptapJson } from "@/lib/ai/tagged-tiptap";

type Stage = "inputs" | "structure" | "communication" | "draft";
type AdMode = "ad_lab_beats" | "ad_lab_dialogue_design" | "ad_lab_draft" | "ad_lab_iterate" | "ad_lab_dialogue_pass";
type Turn = { id: string; stage: Exclude<Stage, "inputs">; user: string; title: string; output: string; status: "running" | "complete" | "failed"; error?: string; version: number };

interface Props {
  documentId: string;
  tabs: TabRow[];
  modelId: string;
  thinking: boolean;
  onRefreshTabs: () => Promise<TabRow[]>;
  onSaved: (tabId: string) => Promise<void>;
}

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "inputs", label: "Stage 1: Inputs" },
  { id: "structure", label: "Stage 2: Structure" },
  { id: "communication", label: "Stage 3: Communication" },
  { id: "draft", label: "Stage 4: Draft" },
];

async function runModel(documentId: string, modelId: string, thinking: boolean, mode: AdMode, content: string): Promise<string> {
  const response = await fetch("/api/ai/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, documentId, modelId, thinking, messages: [{ role: "user", content }] }),
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

function localStructure() {
  return "A — NEW CLIP: Introduce the advertising hook.\nB — EXISTING FOOTAGE: Prove the hook with the writer-supplied series moment.\nC — NEW CLIP: Escalate or reframe the advertising idea.\nD — EXISTING FOOTAGE: Complete the sell with writer-supplied evidence, payoff, or intrigue.";
}

function localCommunication() {
  return "A: Lead with a strong Visual; add On-screen Text only if it sharpens the hook.\nB: Show Source Footage and the exact visible story evidence.\nC: Use Visual, Dialogue, or V.O. to advance the framing.\nD: Show Source Footage and finish with the strongest payoff or CTA.\nWriter Notes remain optional in every section.";
}

export default function AdLabWorkspace({ documentId, tabs, modelId, thinking, onRefreshTabs, onSaved }: Props) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [stage, setStage] = useState<Stage>("inputs");
  const [autoRunToDraft, setAutoRunToDraft] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [composer, setComposer] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const adsTab = useMemo(() => tabs.find((tab) => tab.type === "ads"), [tabs]);
  const localMode = modelId === "local-sample" || modelId === "";
  const source = `Ad name: ${name.trim()}\nWriter brief (the only allowed source for B and D):\n${brief.trim() || "No footage supplied yet."}`;
  const latest = (target: Exclude<Stage, "inputs">) => [...turns].reverse().find((turn) => turn.stage === target && turn.status === "complete");
  const latestStructure = latest("structure")?.output ?? "";
  const latestCommunication = latest("communication")?.output ?? "";
  const latestDraft = latest("draft")?.output ?? "";
  const visibleTurns = stage === "inputs" ? [] : turns.filter((turn) => turn.stage === stage);

  const execute = async (target: Exclude<Stage, "inputs">, mode: AdMode, user: string, context: string, localOutput: string, title: string) => {
    const id = crypto.randomUUID();
    const version = turns.filter((turn) => turn.stage === target).length + 1;
    const pending: Turn = { id, stage: target, user, title, output: "", status: "running", version };
    setTurns((current) => [...current, pending]);
    setRunning(true); setMessage(null);
    try {
      const output = localMode ? localOutput : await runModel(documentId, modelId, thinking, mode, context);
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, output, status: "complete" } : turn));
      if (target === "draft") setSavedDraft(null);
      return output;
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Ad Lab failed.";
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, status: "failed", error: errorText } : turn));
      setMessage(errorText);
      return null;
    } finally { setRunning(false); }
  };

  const begin = async () => {
    if (!name.trim()) { setMessage("Add an ad name first."); return; }
    if (!autoRunToDraft) {
      setStage("structure");
      await execute("structure", "ad_lab_beats", "Build the A–B–C–D structure from these inputs.", source, localStructure(), "Structure Planner");
      return;
    }

    setStage("draft");
    const structureOutput = await execute("structure", "ad_lab_beats", "Build the A–B–C–D structure from these inputs.", source, localStructure(), "Structure Planner");
    if (!structureOutput) return;
    const communicationOutput = await execute("communication", "ad_lab_dialogue_design", "Build the communication design from the approved structure.", `${source}\n\nApproved structure:\n${structureOutput}`, localCommunication(), "Communication Designer");
    if (!communicationOutput) return;
    await execute("draft", "ad_lab_draft", "Write the first A–B–C–D ad draft.", `${source}\n\nApproved structure:\n${structureOutput}\n\nApproved communication design:\n${communicationOutput}`, buildLocalAdDraft(name, brief), "Ad Draft Writer");
  };

  const approveAndContinue = async () => {
    if (stage === "structure" && latestStructure) {
      setStage("communication");
      await execute("communication", "ad_lab_dialogue_design", "Build the communication design from the approved structure.", `${source}\n\nApproved structure:\n${latestStructure}`, localCommunication(), "Communication Designer");
    } else if (stage === "communication" && latestCommunication) {
      setStage("draft");
      await execute("draft", "ad_lab_draft", "Write the first A–B–C–D ad draft.", `${source}\n\nApproved structure:\n${latestStructure}\n\nApproved communication design:\n${latestCommunication}`, buildLocalAdDraft(name, brief), "Ad Draft Writer");
    }
  };

  const giveFeedback = async () => {
    const feedback = composer.trim();
    if (!feedback || stage === "inputs") return;
    setComposer("");
    if (stage === "structure") {
      await execute("structure", "ad_lab_beats", feedback, `${source}\n\nCurrent structure:\n${latestStructure}\n\nWriter feedback:\n${feedback}`, localStructure(), "Structure Planner");
    } else if (stage === "communication") {
      await execute("communication", "ad_lab_dialogue_design", feedback, `${source}\n\nApproved structure:\n${latestStructure}\n\nCurrent communication design:\n${latestCommunication}\n\nWriter feedback:\n${feedback}`, localCommunication(), "Communication Designer");
    } else {
      const localRevision = latestDraft.replace("[P] B — EXISTING FOOTAGE", `[UL] (Writer Notes: ${feedback.replace(/[\[\]]/g, "").trim()})\n[P] B — EXISTING FOOTAGE`);
      await execute("draft", "ad_lab_iterate", feedback, `${source}\n\nCurrent draft:\n${latestDraft}\n\nWriter feedback:\n${feedback}`, localRevision, "Draft Reviser");
    }
  };

  const rerun = async (turn: Turn) => {
    const mode: AdMode = turn.stage === "structure" ? "ad_lab_beats" : turn.stage === "communication" ? "ad_lab_dialogue_design" : "ad_lab_iterate";
    await execute(turn.stage, mode, `Rerun ${turn.title} from the current inputs.`, `${source}\n\nCurrent output:\n${turn.output}`, turn.output, turn.title);
  };

  const save = async () => {
    const validity = validateAdDraft(latestDraft);
    if (!validity.ok) { setMessage(validity.error ?? "The draft is not ready to save."); return; }
    if (savedDraft === latestDraft) { setMessage("This draft is already saved to Ads."); return; }
    setSaving(true); setMessage(null);
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
      setSavedDraft(latestDraft); setMessage("Saved to the Series Ads tab.");
      await onSaved(target.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed."); }
    finally { setSaving(false); }
  };

  const updateTurn = (turn: Turn) => {
    setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, output: editingText } : item));
    setEditingTurnId(null); setEditingText(""); setSavedDraft(null);
  };

  return <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Ad Lab</p><h1 className="mt-1 truncate text-base font-semibold text-foreground">{name.trim() || "Build an A–B–C–D Ad"}</h1><p className="mt-1 truncate text-xs text-muted-foreground">A/C are new clips. B/D use only footage you describe.</p></div>
        <div className="flex shrink-0 rounded-full border border-border bg-muted p-1 text-xs">{STAGES.map((item) => <span key={item.id} className={`whitespace-nowrap rounded-full px-3 py-1 ${stage === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{item.label}</span>)}</div>
      </div>
    </div>

    {stage === "inputs" ? <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><section className="mx-auto max-w-4xl space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm"><div><h2 className="text-base font-semibold">Ad inputs</h2><p className="mt-1 text-sm text-muted-foreground">Name the ad and describe the idea plus the exact series footage available for B and D.</p></div><label className="block text-sm font-medium">Ad name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. The Door Was Already Open" className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500" /></label><label className="block text-sm font-medium">Ad brief<textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={12} placeholder="Describe the ad idea and the exact existing series moments available for B and D…" className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-emerald-500" /></label><div className="flex flex-wrap items-end justify-between gap-4"><label className="flex min-w-[220px] items-start gap-3"><input type="checkbox" checked={autoRunToDraft} onChange={(event) => setAutoRunToDraft(event.target.checked)} disabled={running} className="mt-1 h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500" /><span><span className="block text-sm font-medium">Auto-run to Draft</span><span className="block text-xs leading-relaxed text-muted-foreground">Runs structure, communication design, and the ad draft without stopping for review.</span></span></label><button type="button" onClick={begin} disabled={running} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{running ? "Running Pipeline..." : autoRunToDraft ? "Generate Draft" : "Build A–B–C–D Structure"}</button></div></section>{message && <Status text={message} />}</div> : <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <section className="rounded-md border border-border bg-muted/40 px-4 py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current ad</p><p className="mt-1 text-sm font-medium">{name}</p></div><button type="button" onClick={() => setStage("inputs")} disabled={running} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">Edit inputs</button></div></section>
        {stage === "draft" && (latestStructure || latestCommunication) && <details className="rounded-lg border border-border bg-card shadow-sm"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Pipeline</summary><div className="space-y-3 border-t border-border p-4"><PipelineCard title="Structure" output={latestStructure} /><PipelineCard title="Communication Design" output={latestCommunication} /></div></details>}
        {visibleTurns.length === 0 ? <section className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">The next Ad Lab response will appear here.</section> : <section className="space-y-4">{visibleTurns.map((turn) => {
          const isEditing = editingTurnId === turn.id;
          return <div key={turn.id} className="space-y-3"><article className="rounded-lg border border-border bg-muted p-4"><h2 className="mb-2 text-sm font-semibold">User</h2><pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{turn.user}</pre></article><article className={`rounded-lg border p-4 ${turn.status === "failed" ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : "border-emerald-200 bg-card dark:border-emerald-900"}`}><div className="mb-2 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{turn.title}</h2><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${turn.status === "running" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200" : turn.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"}`}>{turn.status === "running" ? "Running" : turn.status === "failed" ? "Failed" : `Latest · v${turn.version}`}</span></div><div className="flex gap-2">{turn.status === "complete" && !isEditing && <><button type="button" onClick={() => { setEditingTurnId(turn.id); setEditingText(turn.output); }} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">Edit</button><button type="button" disabled={running} onClick={() => void rerun(turn)} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50">Rerun</button><button type="button" onClick={async () => { await navigator.clipboard.writeText(turn.output); setCopiedTurnId(turn.id); }} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">{copiedTurnId === turn.id ? "Copied" : "Copy"}</button></>}</div></div>{isEditing ? <textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} className="min-h-72 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-emerald-500" /> : <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{turn.status === "failed" ? `Failed: ${turn.error}` : turn.output || "Working..."}</pre>}{isEditing && <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3"><button type="button" onClick={() => setEditingTurnId(null)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">Cancel</button><button type="button" onClick={() => updateTurn(turn)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">Save</button></div>}</article></div>;
        })}</section>}
        {message && <Status text={message} />}
      </div>
      <div className="border-t border-border bg-card px-6 py-4"><div className="mx-auto max-w-6xl"><label className="block"><span className="text-sm font-medium">{stage === "structure" ? "What should change in the A–B–C–D structure?" : stage === "communication" ? "What should change in the communication design?" : "What should change in the ad draft?"}</span><textarea value={composer} onChange={(event) => setComposer(event.target.value)} disabled={running} placeholder="Example: Make the hook faster and preserve the writer-supplied footage." className="mt-2 h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-60" /></label><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{stage === "structure" && <button type="button" onClick={approveAndContinue} disabled={running || !latestStructure} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Approve Structure & Build Communication</button>}{stage === "communication" && <button type="button" onClick={approveAndContinue} disabled={running || !latestCommunication} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Approve Communication & Generate Ad</button>}{stage === "draft" && <button type="button" onClick={save} disabled={saving || running || !latestDraft} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "Saving..." : "Save to Ads"}</button>}</div><button type="button" onClick={giveFeedback} disabled={running || !composer.trim()} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{running ? "Running..." : "Give Feedback"}</button></div></div></div>
    </>}
  </main>;
}

function PipelineCard({ title, output }: { title: string; output: string }) {
  return <section className="rounded-md border border-border bg-background p-3"><p className="mb-2 text-sm font-semibold">{title}</p><pre className="max-h-60 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">{output}</pre></section>;
}

function Status({ text }: { text: string }) {
  return <p role="status" className="mx-auto mt-4 max-w-4xl rounded-md border border-border bg-muted px-3 py-2 text-sm">{text}</p>;
}
