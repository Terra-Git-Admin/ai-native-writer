"use client";

import {
  ChevronDown,
  ChevronLeft,
  Copy,
  History,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  PlotLabAction,
  PlotLabConnectedBatch,
  PlotLabMessage,
  PlotLabReferenceInput,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";

interface PlotLabV2WorkspaceProps {
  documentId: string;
  onClose: () => void;
}

interface ThreadResponse {
  session: PlotLabSessionState | null;
  messages: PlotLabMessage[];
  canonical?: ThreadResponse;
  error?: string;
  code?: string;
}

interface ReferenceDraft {
  id: string;
  type: "text" | "url";
  value: string;
  error?: string;
}

interface HistoryEntry extends PlotLabSessionState {
  archivedAt: string;
}

interface QuestionFeedback {
  messageId: string;
  rating: "up" | "down";
  note?: string;
  updatedAt: string;
}

const MIN_WIDTH = 360;
const MAX_WIDTH = 680;
const DEFAULT_WIDTH = 440;
const WIDTH_STEP = 24;
const NARROW_VIEWPORT = 1024;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function isThreadResponse(value: unknown): value is ThreadResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (record.session === null || typeof record.session === "object") && Array.isArray(record.messages);
}

function phaseLabel(session: PlotLabSessionState | null): string {
  if (!session || session.phase === "intake") return "Start a new story route";
  if (session.phase === "interview") {
    return session.interviewCheckpoint.readyForCreative
      ? "Ready to generate"
      : "Understanding your story";
  }
  if (session.phase === "queued" || session.phase === "creative" || session.phase === "connecting") {
    return "Creating your first batch";
  }
  if (session.phase === "complete") return "Your latest story route";
  return "Needs attention";
}

function activeQuestion(messages: PlotLabMessage[], session: PlotLabSessionState | null) {
  const questionId = session?.interviewCheckpoint.latestQuestionMessageId;
  return questionId
    ? messages.find((message) => message.id === questionId && !message.supersededAt) ?? null
    : null;
}

function startersFor(message: PlotLabMessage | null): Array<{ id: string; text: string }> {
  const starters = message?.payload?.starters;
  if (!Array.isArray(starters)) return [];
  return starters.flatMap((starter) => {
    if (!starter || typeof starter !== "object") return [];
    const record = starter as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.text === "string"
      ? [{ id: record.id, text: record.text }]
      : [];
  });
}

function toReferences(drafts: ReferenceDraft[]): PlotLabReferenceInput[] {
  return drafts.map((draft) =>
    draft.type === "text"
      ? { type: "text" as const, text: draft.value.trim() }
      : { type: "url" as const, url: draft.value.trim() }
  );
}

function batchForMessage(message: PlotLabMessage): PlotLabConnectedBatch | null {
  const batch = message.payload?.batch;
  if (!batch || typeof batch !== "object") return null;
  const candidate = batch as PlotLabConnectedBatch;
  return Array.isArray(candidate.units) && (candidate.format === "portrait" || candidate.format === "landscape")
    ? candidate
    : null;
}

function unitLabel(batch: PlotLabConnectedBatch, number: number): string {
  return batch.format === "portrait" ? "Episode " + number : "Milestone " + number;
}

function formatBatchForCopy(batch: PlotLabConnectedBatch): string {
  const heading = batch.format === "landscape" ? "Chapter 1\n\n" : "";
  return heading + batch.units.map((unit) => {
    const title = unit.title ? " — " + unit.title : "";
    return unitLabel(batch, unit.number) + title + "\n" + unit.visiblePlot;
  }).join("\n\n");
}

function validateReferences(drafts: ReferenceDraft[]): ReferenceDraft[] {
  return drafts.map((draft) => {
    const value = draft.value.trim();
    if (!value) return { ...draft, error: draft.type === "text" ? "Paste some text." : "Enter a link." };
    if (draft.type === "url") {
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
      } catch {
        return { ...draft, error: "Use a complete http:// or https:// link." };
      }
      return {
        ...draft,
        error: "Link capture is not available in this local phase. Paste the reference text instead.",
      };
    }
    return { ...draft, error: undefined };
  });
}

export default function PlotLabV2Workspace({ documentId, onClose }: PlotLabV2WorkspaceProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const widthRef = useRef(DEFAULT_WIDTH);
  const [thread, setThread] = useState<ThreadResponse>({ session: null, messages: [] });
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState("");
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceDraft[]>([]);
  const [composer, setComposer] = useState("");
  const [selectedStarterId, setSelectedStarterId] = useState<string | undefined>();
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
  const [editingAnswer, setEditingAnswer] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [archivedThread, setArchivedThread] = useState<ThreadResponse | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [questionFeedback, setQuestionFeedback] = useState<Record<string, QuestionFeedback>>({});
  const [feedbackDialog, setFeedbackDialog] = useState<{ messageId: string; note: string } | null>(null);
  const [feedbackSavingId, setFeedbackSavingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const setPaneWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
    try {
      localStorage.setItem("plot-lab-v2-pane-width", String(clamped));
    } catch {
      // Width persistence is best effort.
    }
  }, []);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("plot-lab-v2-pane-width"));
      if (Number.isFinite(saved)) setPaneWidth(saved);
    } catch {
      // Local storage is optional.
    }
  }, [setPaneWidth]);

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth < NARROW_VIEWPORT);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/plot-lab/session`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as ThreadResponse;
      if (!response.ok || !isThreadResponse(body)) {
        throw new Error(body.error || `Could not load Plot Lab (${response.status}).`);
      }
      setThread(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Plot Lab.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}/plot-lab/feedback`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { feedback?: QuestionFeedback[] };
        if (!response.ok) throw new Error("Could not load question feedback.");
        if (!cancelled) {
          setQuestionFeedback(Object.fromEntries((body.feedback ?? []).map((item) => [item.messageId, item])));
        }
      })
      .catch(() => {
        // Feedback controls remain usable even if the initial status read fails.
      });
    return () => { cancelled = true; };
  }, [documentId]);

  useEffect(() => {
    if (
      !thread.session?.activeJobId ||
      !["queued", "creative", "connecting"].includes(thread.session.phase)
    ) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(
          "/api/documents/" + documentId + "/plot-lab/session",
          { cache: "no-store" }
        );
        const body = (await response.json().catch(() => ({}))) as ThreadResponse;
        if (response.ok && isThreadResponse(body)) setThread(body);
      } catch {
        // The next poll or a manual reload can recover a transient read failure.
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [documentId, thread.session?.activeJobId, thread.session?.phase]);

  const draftKey = `plot-lab-v2-draft:${documentId}:${thread.session?.sessionId ?? "intake"}`;
  useEffect(() => {
    try {
      setComposer(localStorage.getItem(draftKey) ?? "");
    } catch {
      setComposer("");
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, composer);
    } catch {
      // Draft persistence is best effort.
    }
  }, [composer, draftKey]);

  useEffect(() => {
    if (!scrollRef.current || archivedThread) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.messages, archivedThread, mutating]);

  const sendAction = useCallback(async (action: PlotLabAction) => {
    if (mutating) return false;
    setMutating(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/plot-lab/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          expectedRevision: thread.session?.revision ?? 0,
          action,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ThreadResponse;
      if (!response.ok) {
        if (isThreadResponse(body.canonical)) setThread(body.canonical);
        throw new Error(body.error || `Plot Lab could not complete that action (${response.status}).`);
      }
      if (!isThreadResponse(body)) throw new Error("Plot Lab returned an incomplete response.");
      setThread(body);
      setArchivedThread(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Plot Lab could not complete that action.");
      return false;
    } finally {
      setMutating(false);
    }
  }, [documentId, mutating, thread.session?.revision]);

  const startSession = useCallback(async () => {
    if (!seed.trim()) {
      setError("Add a seed before starting with Levi.");
      return;
    }
    const validated = validateReferences(references);
    setReferences(validated);
    if (validated.some((reference) => reference.error)) {
      setError("Fix the highlighted reference before starting.");
      return;
    }
    const started = await sendAction({ kind: "start", seed: seed.trim(), references: toReferences(validated) });
    if (started) {
      setSeed("");
      setReferences([]);
      setReferencesOpen(false);
    }
  }, [references, seed, sendAction]);

  const question = useMemo(() => activeQuestion(thread.messages, thread.session), [thread]);
  const starters = useMemo(() => startersFor(question), [question]);

  const submitComposer = useCallback(async () => {
    const value = composer.trim();
    if (!value || mutating || archivedThread) return;
    const action: PlotLabAction = question
      ? { kind: "answer", questionMessageId: question.id, text: value, selectedStarterId }
      : { kind: "add_context", text: value };
    const sent = await sendAction(action);
    if (sent) {
      setComposer("");
      setSelectedStarterId(undefined);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // Ignore draft cleanup failures.
      }
    }
  }, [archivedThread, composer, draftKey, mutating, question, selectedStarterId, sendAction]);

  const submitEdit = useCallback(async () => {
    if (!editingAnswerId || !editingAnswer.trim()) return;
    const saved = await sendAction({ kind: "edit_answer", answerMessageId: editingAnswerId, text: editingAnswer.trim() });
    if (saved) {
      setEditingAnswerId(null);
      setEditingAnswer("");
    }
  }, [editingAnswer, editingAnswerId, sendAction]);

  const loadHistory = useCallback(async () => {
    setHistoryOpen(true);
    setMenuOpen(false);
    setHistoryLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/plot-lab/history`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { sessions?: HistoryEntry[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load Plot Lab history.");
      setHistory(body.sessions ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Plot Lab history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [documentId]);

  const openArchivedSession = useCallback(async (sessionId: string) => {
    setHistoryLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/documents/${documentId}/plot-lab/history?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      );
      const body = (await response.json().catch(() => ({}))) as ThreadResponse;
      if (!response.ok || !isThreadResponse(body)) throw new Error(body.error || "Could not load that session.");
      setArchivedThread(body);
      setHistoryOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load that session.");
    } finally {
      setHistoryLoading(false);
    }
  }, [documentId]);

  const restart = useCallback(async () => {
    const restarted = await sendAction({ kind: "restart" });
    if (restarted) {
      setRestartOpen(false);
      setSeed("");
      setReferences([]);
      setComposer("");
    }
  }, [sendAction]);

  const retryFailedGeneration = useCallback(async () => {
    const jobId = thread.session?.activeJobId;
    if (!jobId || thread.session?.phase !== "recoverable_error") return;
    await sendAction({ kind: "retry_failed_stage", jobId });
  }, [sendAction, thread.session?.activeJobId, thread.session?.phase]);

  const saveQuestionFeedback = useCallback(async (
    messageId: string,
    rating: "up" | "down",
    note = ""
  ) => {
    if (feedbackSavingId) return false;
    setFeedbackSavingId(messageId);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/plot-lab/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating, note }),
      });
      const body = await response.json().catch(() => ({})) as { feedback?: QuestionFeedback; error?: string };
      if (!response.ok || !body.feedback) {
        throw new Error(body.error || "Could not save question feedback.");
      }
      setQuestionFeedback((current) => ({ ...current, [messageId]: body.feedback! }));
      setFeedbackDialog(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save question feedback.");
      return false;
    } finally {
      setFeedbackSavingId(null);
    }
  }, [documentId, feedbackSavingId]);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const onMove = (moveEvent: PointerEvent) => setPaneWidth(startWidth + startX - moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [setPaneWidth]);

  const resizeWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return;
    event.preventDefault();
    if (event.key === "Home") setPaneWidth(DEFAULT_WIDTH);
    else setPaneWidth(widthRef.current + (event.key === "ArrowLeft" ? WIDTH_STEP : -WIDTH_STEP));
  }, [setPaneWidth]);

  const visibleThread = archivedThread ?? thread;
  const canRestart = Boolean(thread.session?.seed);

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-border bg-background"
      style={{ width }}
      aria-label="Plot Lab"
    >
      <div
        role="separator"
        aria-label="Resize Plot Lab pane"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={() => setPaneWidth(DEFAULT_WIDTH)}
        title="Drag to resize. Use Left and Right arrows, or press Home to reset."
        className="absolute bottom-0 left-0 top-0 z-20 w-2 -translate-x-1/2 cursor-col-resize focus-visible:bg-indigo-400 focus-visible:outline-none"
      />

      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
        <div className="min-w-0">
          {archivedThread ? (
            <button
              type="button"
              onClick={() => {
                setArchivedThread(null);
                setHistoryOpen(true);
              }}
              className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              History
            </button>
          ) : (
            <>
              <h2 className="truncate text-sm font-semibold text-foreground">Plot Lab</h2>
              <p className="truncate text-xs text-muted-foreground">Levi · {phaseLabel(thread.session)}</p>
            </>
          )}
        </div>
        <div className="relative flex items-center gap-1">
          {!archivedThread ? (
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Plot Lab menu"
              aria-expanded={menuOpen}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Plot Lab"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="absolute right-10 top-11 z-30 w-52 rounded-lg border border-border bg-card p-1.5 shadow-lg">
              <button
                type="button"
                onClick={() => void loadHistory()}
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <History className="h-4 w-4" aria-hidden="true" />
                Session history
              </button>
              <button
                type="button"
                disabled={!canRestart}
                onClick={() => {
                  setMenuOpen(false);
                  setRestartOpen(true);
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Restart with Levi
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {isNarrow ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-xs rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-sm font-semibold text-foreground">Plot Lab requires a wider window</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Widen the browser to keep the editor and Levi usable side by side.
            </p>
          </div>
        </div>
      ) : historyOpen ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Session history</h3>
              <p className="mt-1 text-xs text-muted-foreground">Archived sessions are read-only.</p>
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Close session history"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {historyLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading history…
            </div>
          ) : history.length ? (
            <div className="space-y-2">
              {history.map((entry) => (
                <button
                  key={entry.sessionId}
                  type="button"
                  onClick={() => void openArchivedSession(entry.sessionId)}
                  className="w-full rounded-lg border border-border bg-card p-3 text-left hover:border-indigo-300 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="block truncate text-sm font-medium text-foreground">{entry.seed || "Untitled session"}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Archived {new Date(entry.archivedAt).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
              No archived sessions yet.
            </p>
          )}
        </div>
      ) : loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading Plot Lab…
        </div>
      ) : !thread.session?.seed ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-foreground">What should Levi help you build?</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Add a blurb, rough sketches, or the continuation you want to explore.
            </p>
            <label htmlFor="plot-lab-seed" className="mt-4 block text-xs font-medium text-foreground">
              Story seed <span className="text-red-600">*</span>
            </label>
            <textarea
              id="plot-lab-seed"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              rows={6}
              placeholder="Paste your blurb or describe where the story should go…"
              className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900"
            />
            <button
              type="button"
              onClick={() => setReferencesOpen((open) => !open)}
              aria-expanded={referencesOpen}
              className="mt-3 flex min-h-10 w-full items-center justify-between rounded-md px-1 text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Add context or references
              <ChevronDown className={`h-4 w-4 transition-transform ${referencesOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {referencesOpen ? (
              <div className="mt-2 space-y-3 border-t border-border pt-3">
                {references.map((reference) => (
                  <div key={reference.id}>
                    <div className="flex items-start gap-2">
                      <textarea
                        value={reference.value}
                        onChange={(event) => setReferences((current) => current.map((item) => item.id === reference.id ? { ...item, value: event.target.value, error: undefined } : item))}
                        rows={reference.type === "text" ? 3 : 1}
                        aria-label={reference.type === "text" ? "Pasted reference text" : "Reference link"}
                        aria-invalid={Boolean(reference.error)}
                        placeholder={reference.type === "text" ? "Paste profile, research, or notes…" : "https://example.com/reference"}
                        className={`min-w-0 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ${reference.error ? "border-red-400 focus:ring-red-200" : "border-border focus:border-indigo-400 focus:ring-indigo-200 dark:focus:ring-indigo-900"}`}
                      />
                      <button
                        type="button"
                        onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label="Remove reference"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    {reference.error ? <p className="mt-1 text-xs text-red-600">{reference.error}</p> : null}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={references.length >= 10}
                    onClick={() => setReferences((current) => [...current, { id: crypto.randomUUID(), type: "text", value: "" }])}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-45"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Paste text
                  </button>
                  <button
                    type="button"
                    disabled={references.length >= 10}
                    onClick={() => setReferences((current) => [...current, { id: crypto.randomUUID(), type: "url", value: "" }])}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-45"
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Add link
                  </button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Link capture is visible for flow testing but remains unavailable until safe server fetching is added.
                </p>
              </div>
            ) : null}
            {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
            <button
              type="button"
              onClick={() => void startSession()}
              disabled={mutating || !seed.trim()}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              Start with Levi
            </button>
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {archivedThread ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                Read-only archived session
              </div>
            ) : null}
            {visibleThread.messages.filter((message) => !message.supersededAt).map((message) => {
              const isWriter = message.role === "writer";
              const isEditableAnswer = !archivedThread && message.kind === "answer" && !message.supersededAt;
              const batch = batchForMessage(message);
              if (batch) {
                return (
                  <div key={message.id} className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 shadow-sm dark:border-indigo-900/70 dark:bg-indigo-950/20">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{message.content}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {batch.format === "portrait" ? "Episodes 2–8" : "Chapter 1"} · Version {batch.version}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(formatBatchForCopy(batch));
                          setCopiedMessageId(message.id + ":all");
                          window.setTimeout(() => setCopiedMessageId(null), 1500);
                        }}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        {copiedMessageId === message.id + ":all" ? "Copied" : "Copy all"}
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {batch.units.map((unit) => {
                        const copyKey = message.id + ":unit:" + unit.number;
                        return (
                          <article key={unit.number} className="rounded-lg border border-border bg-card p-3">
                            <div className="flex items-start justify-between gap-3">
                              <h4 className="text-sm font-semibold text-foreground">
                                {unitLabel(batch, unit.number)}{unit.title ? " — " + unit.title : ""}
                              </h4>
                              <button
                                type="button"
                                onClick={async () => {
                                  const title = unitLabel(batch, unit.number) + (unit.title ? " — " + unit.title : "");
                                  await navigator.clipboard.writeText(title + "\n" + unit.visiblePlot);
                                  setCopiedMessageId(copyKey);
                                  window.setTimeout(() => setCopiedMessageId(null), 1500);
                                }}
                                className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                              >
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                {copiedMessageId === copyKey ? "Copied" : "Copy"}
                              </button>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground">{unit.visiblePlot}</p>
                          </article>
                        );
                      })}
                    </div>
                    {batch.warnings.length ? (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        {batch.warnings.join(" ")}
                      </div>
                    ) : null}
                  </div>
                );
              }
              return (
                <div key={message.id} className={`flex ${isWriter ? "justify-end" : "justify-start"}`}>
                  <div className={`${isWriter ? "max-w-[84%]" : "max-w-[94%]"}`}>
                    {editingAnswerId === message.id ? (
                      <div className="w-full min-w-[280px] rounded-lg border border-indigo-300 bg-card p-3 shadow-sm">
                        <label htmlFor={`edit-${message.id}`} className="text-xs font-medium text-foreground">Edit answer</label>
                        <textarea
                          id={`edit-${message.id}`}
                          value={editingAnswer}
                          onChange={(event) => setEditingAnswer(event.target.value)}
                          rows={3}
                          className="mt-1.5 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingAnswerId(null)} className="min-h-10 rounded-md px-3 text-xs font-medium hover:bg-muted">Cancel</button>
                          <button type="button" onClick={() => void submitEdit()} disabled={mutating || !editingAnswer.trim()} className="min-h-10 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white disabled:opacity-50">Save answer</button>
                        </div>
                      </div>
                    ) : (
                      <div className={`group rounded-lg px-3.5 py-3 text-sm leading-6 ${isWriter ? "bg-indigo-600 text-white" : message.role === "system" ? "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" : "border border-border bg-card text-foreground shadow-sm"}`}>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        <div className={`mt-1 flex items-center gap-1 ${isWriter ? "justify-end" : "justify-start"}`}>
                          {isEditableAnswer ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAnswerId(message.id);
                                setEditingAnswer(message.content);
                              }}
                              className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-[11px] text-indigo-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
                            </button>
                          ) : null}
                          {!isWriter && message.kind !== "interview_question" ? (
                            <button
                              type="button"
                              onClick={async () => {
                                await navigator.clipboard.writeText(message.content);
                                setCopiedMessageId(message.id);
                                window.setTimeout(() => setCopiedMessageId(null), 1500);
                              }}
                              className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                              <Copy className="h-3 w-3" aria-hidden="true" /> {copiedMessageId === message.id ? "Copied" : "Copy"}
                            </button>
                          ) : null}
                          {message.role === "levi" && message.kind === "interview_question" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void saveQuestionFeedback(message.id, "up")}
                                disabled={feedbackSavingId === message.id}
                                aria-label="Mark this Levi question helpful"
                                aria-pressed={questionFeedback[message.id]?.rating === "up"}
                                title="Helpful question"
                                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 dark:hover:bg-emerald-950/30 ${questionFeedback[message.id]?.rating === "up" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : ""}`}
                              >
                                <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setFeedbackDialog({ messageId: message.id, note: questionFeedback[message.id]?.note ?? "" })}
                                disabled={feedbackSavingId === message.id}
                                aria-label="Give feedback on this Levi question"
                                aria-pressed={questionFeedback[message.id]?.rating === "down"}
                                title="Question needs work"
                                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:hover:bg-red-950/30 ${questionFeedback[message.id]?.rating === "down" ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : ""}`}
                              >
                                <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {!archivedThread && starters.length ? (
              <div className="space-y-2">
                {starters.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    onClick={() => {
                      setComposer(starter.text);
                      setSelectedStarterId(starter.id);
                      composerRef.current?.focus();
                    }}
                    className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-sm leading-5 text-foreground hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950/20"
                  >
                    {starter.text}
                  </button>
                ))}
              </div>
            ) : null}
            {mutating || ["queued", "creative", "connecting"].includes(thread.session?.phase ?? "") ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {thread.session?.activeJobId ? "Levi is creating the connected batch…" : "Levi is updating the session…"}
              </div>
            ) : null}
            {error ? (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            ) : null}
          </div>
          {!archivedThread ? (
            <footer className="border-t border-border p-3">
              {thread.session?.phase === "recoverable_error" ? (
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                  <p className="text-sm font-medium">The batch stopped before it finished.</p>
                  <p className="mt-1 text-xs leading-5 opacity-80">
                    Your interview and completed creative work are saved. Retry resumes from the failed stage.
                  </p>
                  <button
                    type="button"
                    onClick={() => void retryFailedGeneration()}
                    disabled={mutating || !thread.session.activeJobId}
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mutating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                    Retry generation
                  </button>
                </div>
              ) : null}
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{phaseLabel(thread.session)}</span>
                {thread.session?.phase === "interview" ? (
                  <button
                    type="button"
                    onClick={() => void sendAction({ kind: "request_generation" })}
                    disabled={mutating}
                    className="min-h-9 rounded-md px-2.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                  >
                    Generate now
                  </button>
                ) : null}
              </div>
              <div className="rounded-lg border border-border bg-card focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200 dark:focus-within:ring-indigo-900">
                <textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(event) => {
                    setComposer(event.target.value);
                    setSelectedStarterId(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void submitComposer();
                    }
                  }}
                  rows={3}
                  placeholder={
                    thread.session?.phase === "complete"
                      ? "Follow-up chat arrives in the next slice."
                      : thread.session?.activeJobId
                        ? "Levi is creating the batch…"
                        : question
                          ? "Answer Levi or add your own direction…"
                          : "Add more context for Levi…"
                  }
                  disabled={mutating || thread.session?.phase !== "interview"}
                  className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
                />
                <div className="flex items-center justify-between gap-3 border-t border-border px-2 py-2">
                  <span className="text-[11px] text-muted-foreground">Ctrl/⌘ + Enter to send</span>
                  <button
                    type="button"
                    onClick={() => void submitComposer()}
                    disabled={mutating || thread.session?.phase !== "interview" || !composer.trim()}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" /> Send
                  </button>
                </div>
              </div>
            </footer>
          ) : null}
        </>
      )}

      {restartOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="plot-lab-restart-title" className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 id="plot-lab-restart-title" className="text-base font-semibold text-foreground">Restart with Levi?</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This clears the current seed, references, interview answers, and generated work. The current session stays available as read-only history. Document tabs are not changed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRestartOpen(false)} disabled={mutating} className="min-h-10 rounded-md px-3 text-sm font-medium hover:bg-muted">Cancel</button>
              <button type="button" onClick={() => void restart()} disabled={mutating} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
                {mutating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                Restart
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {feedbackDialog ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="plot-lab-feedback-title" className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="plot-lab-feedback-title" className="text-base font-semibold text-foreground">What should Levi improve?</h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">This feedback is saved for question quality. It will not become story canon.</p>
              </div>
              <button type="button" onClick={() => setFeedbackDialog(null)} disabled={Boolean(feedbackSavingId)} aria-label="Close feedback" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <label htmlFor="plot-lab-question-feedback" className="mt-4 block text-sm font-medium text-foreground">Feedback</label>
            <textarea
              id="plot-lab-question-feedback"
              autoFocus
              value={feedbackDialog.note}
              onChange={(event) => setFeedbackDialog((current) => current ? { ...current, note: event.target.value } : current)}
              rows={4}
              maxLength={1000}
              placeholder="For example: this repeats an earlier question, assumes the wrong motivation, or is too narrow."
              className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200 dark:focus:ring-red-900"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFeedbackDialog(null)} disabled={Boolean(feedbackSavingId)} className="min-h-11 rounded-md px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void saveQuestionFeedback(feedbackDialog.messageId, "down", feedbackDialog.note)} disabled={Boolean(feedbackSavingId) || !feedbackDialog.note.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50">
                {feedbackSavingId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ThumbsDown className="h-4 w-4" aria-hidden="true" />}
                Save feedback
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
