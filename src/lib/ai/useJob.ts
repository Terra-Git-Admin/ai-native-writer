"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type JobKind =
  | "plot_chunks"
  | "next_episode_plot"
  | "next_reference_episode"
  | "format_tab"
  | "series_skeleton"
  | "series_skeleton_predefined"
  | "series_skeleton_auto";

export type JobStatus =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobState {
  jobId: string | null;
  kind: JobKind | null;
  status: JobStatus;
  output: string;
  error: string | null;
  // Tab the job was started against. Snapshotted at start() time and frozen
  // for the lifetime of the job — never reactively updated from args.tabId.
  // The apply path reads this so cross-tab writes route to the origin tab,
  // not whatever tab is active when the user clicks Apply.
  originTabId: string | null;
}

const IDLE: JobState = {
  jobId: null,
  kind: null,
  status: "idle",
  output: "",
  error: null,
  originTabId: null,
};

interface UseJobArgs {
  documentId: string;
  tabId: string;
  modelId: string;
  thinking: boolean;
}

// Manages a single in-flight AI job for a (documentId, tabId) scope. UI
// is "block & toast" — only one job at a time per tab. The hook holds an
// EventSource for the SSE stream and tears it down on completion or unmount.
//
// Persistence across remounts: the hook is doc-page level (same level as
// the AIChatSidebar conditional), so as long as that conditional stays
// truthy across tab switches, this hook's state is preserved. A page reload
// loses the in-memory state; a future enhancement is to read localStorage
// for an active jobId on mount and reattach.
export function useJob(args: UseJobArgs) {
  const [state, setState] = useState<JobState>(IDLE);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Tear down the EventSource on unmount.
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  const subscribe = useCallback((jobId: string, kind: JobKind, originTabId: string) => {
    // Close any prior subscription.
    eventSourceRef.current?.close();

    const es = new EventSource(`/api/ai/jobs/${jobId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("token", (e) => {
      const evt = e as MessageEvent<string>;
      // Server always JSON.stringifies before sending so newlines survive
      // the SSE wire format. Token events carry a JSON-encoded string.
      const chunk = JSON.parse(evt.data) as string;
      setState((prev) => ({
        ...prev,
        status: "running",
        output: prev.output + chunk,
      }));
    });

    es.addEventListener("done", (e) => {
      const evt = e as MessageEvent<string>;
      try {
        const payload = JSON.parse(evt.data) as { content?: string };
        setState((prev) => ({
          ...prev,
          status: "completed",
          output: payload.content ?? prev.output,
        }));
      } catch {
        setState((prev) => ({ ...prev, status: "completed" }));
      }
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener("error", (e) => {
      // SSE 'error' fires on both server-emitted error events AND on
      // network-level disconnects. Server-emitted carry data; network
      // disconnects do not.
      const evt = e as MessageEvent<string>;
      let reason = "AI generation failed";
      if (evt.data) {
        try {
          const payload = JSON.parse(evt.data) as { reason?: string };
          reason = payload.reason ?? reason;
        } catch {
          reason = evt.data;
        }
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: reason,
        }));
        es.close();
        eventSourceRef.current = null;
        // Defense in depth: if the SSE bailed because of an evicted-runner
        // race or any other transient server condition, the DB row may
        // still say pending|running — which would block any new job in
        // this doc via the per-doc concurrency check. Fire a cancel to
        // heal the row. Best-effort, ignore failures.
        fetch(`/api/ai/jobs/${jobId}/cancel`, { method: "POST" }).catch(
          () => {}
        );
      }
      // Network blip: do nothing — EventSource auto-reconnects. If the
      // server has truly gone away, the next 'error' with data will fire.
    });

    es.addEventListener("cancelled", () => {
      setState((prev) => ({ ...prev, status: "cancelled" }));
      es.close();
      eventSourceRef.current = null;
    });

    setState({
      jobId,
      kind,
      status: "starting",
      output: "",
      error: null,
      originTabId,
    });
  }, []);

  const start = useCallback(
    async (
      kind: JobKind,
      opts?: { userGuidance?: string }
    ): Promise<{ ok: boolean; error?: string }> => {
      // Reject if an active job already exists in this scope (block & toast).
      if (state.status === "starting" || state.status === "running") {
        return {
          ok: false,
          error: "A generation is already running. Cancel it before starting another.",
        };
      }

      // Snapshot origin tab at start time. The hook's args.tabId is reactive
      // (re-renders when the user switches tabs), but a job's origin must
      // not change after it's been created.
      const originTabId = args.tabId;
      try {
        const res = await fetch("/api/ai/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: args.documentId,
            tabId: originTabId,
            promptKind: kind,
            modelId: args.modelId,
            thinking: args.thinking,
            ...(opts?.userGuidance ? { userGuidance: opts.userGuidance } : {}),
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          return {
            ok: false,
            error: data.error ?? `Server returned ${res.status}`,
          };
        }
        const data = (await res.json()) as { id: string };
        subscribe(data.id, kind, originTabId);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [
      args.documentId,
      args.tabId,
      args.modelId,
      args.thinking,
      state.status,
      subscribe,
    ]
  );

  const cancel = useCallback(async () => {
    if (!state.jobId) return;
    if (state.status !== "starting" && state.status !== "running") return;
    try {
      await fetch(`/api/ai/jobs/${state.jobId}/cancel`, { method: "POST" });
      // Server emits 'cancelled' SSE event which updates state.
    } catch {
      // ignore — server-side runner will eventually complete
    }
  }, [state.jobId, state.status]);

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setState(IDLE);
  }, []);

  return { state, start, cancel, reset };
}
