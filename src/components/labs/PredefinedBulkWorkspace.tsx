"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  LoaderCircle,
  RefreshCw,
  Square,
} from "lucide-react";

type RunStatus = "pending" | "running" | "paused" | "completed" | "cancelled";
type ItemStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";
type ItemStage = "pending" | "beats" | "dialogue" | "draft" | "save" | "complete";

interface PreviewEpisode {
  episodeNumber: number;
  title: string;
}

interface PreviewPayload {
  eligible: PreviewEpisode[];
  skipped: PreviewEpisode[];
  issues: string[];
  planHash: string;
  aiStages: number;
}

export interface PredefinedBulkRunSummary {
  id: string;
  status: RunStatus;
  totalItems: number;
  completedItems: number;
  skippedItems: number;
  currentEpisode: number | null;
  failureReason: string | null;
}

interface BulkItem {
  id: string;
  episodeNumber: number;
  episodeTitle: string;
  positionIndex: number;
  status: ItemStatus;
  currentStage: ItemStage;
  attemptCount: number;
  failureReason: string | null;
  savedSectionUid: string | null;
}

interface BulkRun extends PredefinedBulkRunSummary {
  modelId: string;
  items: BulkItem[];
}

interface Props {
  documentId: string;
  modelId: string;
  thinking: boolean;
  onPrepareStart: () => Promise<boolean>;
  onSaved: () => Promise<void>;
  onRunStateChange: (run: PredefinedBulkRunSummary | null) => void;
  onReviewEpisodes: () => void;
}

function isActive(status: RunStatus | undefined): boolean {
  return status === "pending" || status === "running" || status === "paused";
}

function stageLabel(stage: ItemStage): string {
  if (stage === "beats") return "Building beats";
  if (stage === "dialogue") return "Designing dialogue";
  if (stage === "draft") return "Writing draft";
  if (stage === "save") return "Saving episode";
  if (stage === "complete") return "Complete";
  return "Waiting";
}

function statusLabel(item: BulkItem): string {
  if (item.status === "completed") return "Saved";
  if (item.status === "skipped") return "Already existed";
  if (item.status === "failed") return "Paused";
  if (item.status === "cancelled") return "Stopped";
  if (item.status === "running") return stageLabel(item.currentStage);
  return "Waiting";
}

function StatusIcon({ item }: { item: BulkItem }) {
  if (item.status === "completed") return <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />;
  if (item.status === "skipped") return <Check className="h-5 w-5 text-muted-foreground" aria-hidden="true" />;
  if (item.status === "failed") return <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />;
  if (item.status === "cancelled") return <Square className="h-5 w-5 text-muted-foreground" aria-hidden="true" />;
  if (item.status === "running") return <LoaderCircle className="h-5 w-5 animate-spin text-cyan-600 motion-reduce:animate-none dark:text-cyan-300" aria-hidden="true" />;
  return <Circle className="h-5 w-5 text-muted-foreground/60" aria-hidden="true" />;
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function PredefinedBulkWorkspace({
  documentId,
  modelId,
  thinking,
  onPrepareStart,
  onSaved,
  onRunStateChange,
  onReviewEpisodes,
}: Props) {
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [run, setRun] = useState<BulkRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const lastSavedCountRef = useRef(0);

  const loadPreview = useCallback(async () => {
    const response = await fetch(`/api/documents/${documentId}/predefined-bulk-runs/preview`, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { preview?: PreviewPayload; error?: string };
    if (!response.ok || !body.preview) throw new Error(body.error || "Could not preview bulk generation.");
    setPreview(body.preview);
  }, [documentId]);

  const loadLatest = useCallback(async () => {
    const response = await fetch(`/api/documents/${documentId}/predefined-bulk-runs`, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { run?: BulkRun | null; error?: string };
    if (!response.ok) throw new Error(body.error || "Could not load bulk progress.");
    const nextRun = body.run ?? null;
    setRun(nextRun);
    onRunStateChange(nextRun);
    if (nextRun && nextRun.completedItems > lastSavedCountRef.current) {
      lastSavedCountRef.current = nextRun.completedItems;
      await onSaved();
    }
    return nextRun;
  }, [documentId, onRunStateChange, onSaved]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const latest = await loadLatest();
        if (!cancelled && !isActive(latest?.status)) await loadPreview();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Bulk Generate.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadLatest, loadPreview]);

  useEffect(() => {
    if (!run || !isActive(run.status)) return;
    const interval = window.setInterval(() => {
      void loadLatest().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not refresh progress."));
    }, 2000);
    return () => window.clearInterval(interval);
  }, [loadLatest, run]);

  useEffect(() => {
    if (!confirmStart && !confirmStop) triggerRef.current?.focus();
  }, [confirmStart, confirmStop]);

  const finished = (run?.completedItems ?? 0) + (run?.skippedItems ?? 0);
  const progress = run?.totalItems ? Math.min(1, finished / run.totalItems) : 0;
  const currentItem = run?.items.find((item) => item.status === "running" || item.status === "failed") ?? null;
  const statusAnnouncement = run
    ? run.status === "completed"
      ? `${run.completedItems} episodes saved. Bulk generation complete.`
      : run.status === "paused"
        ? `Bulk generation paused at Episode ${run.currentEpisode ?? "unknown"}.`
        : run.status === "cancelled"
          ? `Bulk generation stopped. ${run.completedItems} episodes were saved.`
          : `Episode ${run.currentEpisode ?? "pending"}. ${currentItem ? stageLabel(currentItem.currentStage) : "Preparing generation"}.`
    : "";

  async function startRun() {
    if (!preview) return;
    setWorking(true);
    setError(null);
    try {
      if (!(await onPrepareStart())) throw new Error("Save the latest document changes before starting Bulk Generate.");
      const refreshed = await fetch(`/api/documents/${documentId}/predefined-bulk-runs/preview`, { cache: "no-store" });
      const refreshedBody = await refreshed.json().catch(() => ({})) as { preview?: PreviewPayload; error?: string };
      if (!refreshed.ok || !refreshedBody.preview) throw new Error(refreshedBody.error || "Could not refresh the bulk plan.");
      if (refreshedBody.preview.planHash !== preview.planHash) {
        setPreview(refreshedBody.preview);
        throw new Error("Plots or predefined episodes changed. Review the updated plan before starting.");
      }
      const response = await fetch(`/api/documents/${documentId}/predefined-bulk-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, thinking, planHash: preview.planHash }),
      });
      const body = await response.json().catch(() => ({})) as { run?: BulkRun; error?: string };
      if (!response.ok || !body.run) throw new Error(body.error || "Could not start Bulk Generate.");
      setRun(body.run);
      onRunStateChange(body.run);
      setConfirmStart(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Bulk Generate.");
      setConfirmStart(false);
    } finally {
      setWorking(false);
    }
  }

  async function mutateRun(action: "retry" | "cancel") {
    if (!run) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/predefined-bulk-runs/${run.id}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { run?: BulkRun; error?: string };
      if (!response.ok || !body.run) throw new Error(body.error || `Could not ${action === "retry" ? "resume" : "stop"} the run.`);
      setRun(body.run);
      onRunStateChange(body.run);
      setConfirmStop(false);
      if (action === "cancel") await loadPreview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bulk action failed.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <div role="status" className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Loading Bulk Generate…</div>;
  }

  if (run && (isActive(run.status) || run.status === "completed" || run.status === "cancelled")) {
    return (
      <div className="space-y-4">
        <span role="status" aria-atomic="true" className="sr-only">{statusAnnouncement}</span>
        <section className={`rounded-lg border p-4 shadow-sm ${run.status === "paused" ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : run.status === "completed" ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-border bg-card"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {run.status === "completed" ? `${run.completedItems} episodes saved` : run.status === "cancelled" ? "Bulk generation stopped" : run.status === "paused" ? `Paused at Episode ${run.currentEpisode ?? "—"}` : `Generating Episode ${run.currentEpisode ?? "—"}`}
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {run.status === "paused" ? run.failureReason : run.status === "completed" ? "Every eligible plot now has a saved predefined draft." : run.status === "cancelled" ? `${run.completedItems} completed episode${run.completedItems === 1 ? " is" : "s are"} safe in Predefined Episodes.` : currentItem ? stageLabel(currentItem.currentStage) : "Preparing the next episode."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {run.status === "paused" && (
                <button type="button" disabled={working} onClick={() => void mutateRun("retry")} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry episode
                </button>
              )}
              {isActive(run.status) && (
                <button ref={triggerRef} type="button" disabled={working} onClick={() => setConfirmStop(true)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30">
                  <Square className="h-4 w-4" aria-hidden="true" /> Stop run
                </button>
              )}
              {run.status === "completed" && (
                <button type="button" onClick={onReviewEpisodes} className="inline-flex min-h-11 items-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                  Review Predefined Episodes
                </button>
              )}
              {run.status === "cancelled" && (
                <button type="button" onClick={() => { setRun(null); onRunStateChange(null); void loadPreview(); }} className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                  Recalculate remaining
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full origin-left bg-emerald-600 transition-transform motion-reduce:transition-none" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{finished} of {run.totalItems} finished</span>
            <span>{run.completedItems} saved · {run.skippedItems} skipped</span>
          </div>
        </section>

        {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

        <section aria-label="Episode generation queue" className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {run.items.map((item) => {
            const expanded = item.status === "running" || item.status === "failed";
            return (
              <article key={item.id} className={`border-b border-border px-4 py-3 last:border-b-0 ${expanded ? "bg-cyan-50/50 dark:bg-cyan-950/15" : ""}`}>
                <div className="flex min-h-11 items-center gap-3">
                  <StatusIcon item={item} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Episode {item.episodeNumber}</p>
                    <p className="[overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{item.episodeTitle}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{statusLabel(item)}</span>
                </div>
                {expanded && (
                  <div className="ml-8 mt-3 grid grid-cols-4 gap-1 text-center text-[11px] text-muted-foreground" aria-label={`Episode ${item.episodeNumber} stages`}>
                    {(["beats", "dialogue", "draft", "save"] as ItemStage[]).map((stage) => {
                      const order = ["beats", "dialogue", "draft", "save"];
                      const activeIndex = order.indexOf(item.currentStage);
                      const stageIndex = order.indexOf(stage);
                      const done = item.status === "completed" || item.status === "skipped" || activeIndex > stageIndex;
                      const active = activeIndex === stageIndex;
                      return <span key={stage} className={`rounded px-1 py-1 ${done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : active ? "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200" : "bg-muted"}`}>{stage === "dialogue" ? "Dialogue" : stage.charAt(0).toUpperCase() + stage.slice(1)}</span>;
                    })}
                  </div>
                )}
                {item.status === "failed" && item.failureReason && <p className="ml-8 mt-2 text-sm leading-6 text-red-700 dark:text-red-300">{item.failureReason}</p>}
              </article>
            );
          })}
        </section>

        {confirmStop && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" role="dialog" aria-modal="true" aria-labelledby="bulk-stop-title" onKeyDown={(event) => trapDialogFocus(event, () => setConfirmStop(false))}>
            <section className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
              <h2 id="bulk-stop-title" className="text-base font-semibold text-foreground">Stop bulk generation?</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{run.completedItems} saved episode{run.completedItems === 1 ? "" : "s"} will remain. The remaining {Math.max(0, run.totalItems - finished)} will not generate.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" autoFocus onClick={() => setConfirmStop(false)} className="min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">Keep running</button>
                <button type="button" disabled={working} onClick={() => void mutateRun("cancel")} className="min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">Stop run</button>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  const eligible = preview?.eligible ?? [];
  const skipped = preview?.skipped ?? [];
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h2 className="text-base font-semibold text-foreground">Generate missing episodes</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Runs Beats, Dialogue Design, and Draft in episode order. Each completed draft saves automatically and becomes continuity context for the next episode.</p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-2 text-right">
            <p className="text-lg font-semibold tabular-nums text-foreground">{eligible.length}</p>
            <p className="text-xs text-muted-foreground">ready</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 @md:grid-cols-3">
          <div className="rounded-md bg-muted px-3 py-3"><p className="text-xs text-muted-foreground">Already exist</p><p className="mt-1 font-semibold tabular-nums">{skipped.length}</p></div>
          <div className="rounded-md bg-muted px-3 py-3"><p className="text-xs text-muted-foreground">AI stages</p><p className="mt-1 font-semibold tabular-nums">{preview?.aiStages ?? 0}</p></div>
          <div className="rounded-md bg-muted px-3 py-3"><p className="text-xs text-muted-foreground">Continuity</p><p className="mt-1 font-semibold">All earlier episodes</p></div>
        </div>
        {eligible.length > 0 && (
          <details className="mt-4 rounded-md border border-border bg-background">
            <summary className="cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500">Episodes included</summary>
            <ul className="grid gap-2 border-t border-border px-3 py-3 text-sm text-muted-foreground @md:grid-cols-2">
              {eligible.map((episode) => <li key={episode.episodeNumber}>Episode {episode.episodeNumber} · {episode.title}</li>)}
            </ul>
          </details>
        )}
        {(preview?.issues.length ?? 0) > 0 && <div role="alert" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">{preview?.issues.join(" ")}</div>}
        {error && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        {eligible.length === 0 && !(preview?.issues.length) && <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">All written plots already have predefined episodes.</div>}
        <div className="mt-5 flex justify-end">
          <button ref={triggerRef} type="button" disabled={!eligible.length || Boolean(preview?.issues.length) || !modelId || working} onClick={() => setConfirmStart(true)} className="inline-flex min-h-11 items-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">Review bulk run</button>
        </div>
      </section>

      {confirmStart && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" role="dialog" aria-modal="true" aria-labelledby="bulk-start-title" onKeyDown={(event) => trapDialogFocus(event, () => setConfirmStart(false))}>
          <section className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-2xl">
            <h2 id="bulk-start-title" className="text-base font-semibold text-foreground">Generate {eligible.length} predefined episode{eligible.length === 1 ? "" : "s"}?</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">This starts {preview.aiStages} paid AI stages. Existing episodes are skipped, successful drafts save immediately, and the run continues if you close the Lab.</p>
            <dl className="mt-4 grid gap-3 rounded-md bg-muted p-3 text-sm @md:grid-cols-2">
              <div><dt className="text-muted-foreground">Beats and Draft</dt><dd className="mt-1 font-medium text-foreground">{modelId}</dd></div>
              <div><dt className="text-muted-foreground">Dialogue Design</dt><dd className="mt-1 font-medium text-foreground">Gemini 3.1 Pro</dd></div>
              <div><dt className="text-muted-foreground">Auto-save</dt><dd className="mt-1 font-medium text-foreground">After every episode</dd></div>
              <div><dt className="text-muted-foreground">Run order</dt><dd className="mt-1 font-medium text-foreground">Sequential</dd></div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" autoFocus disabled={working} onClick={() => setConfirmStart(false)} className="min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">Cancel</button>
              <button type="button" disabled={working} onClick={() => void startRun()} className="min-h-11 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50">{working ? "Starting…" : `Generate ${eligible.length} episodes`}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
