"use client";

// Browser-side tracer. Buffers events for a couple of seconds then POSTs them
// to /api/client-trace so they land in Cloud Run logs alongside server events.
// On page-hide / tab-close, flushes the remaining buffer via navigator.sendBeacon
// so we don't lose the very events we most need (final save, unmount reason, etc).

interface ClientEvent {
  event: string;
  ts: string;
  [k: string]: unknown;
}

const FLUSH_INTERVAL_MS = 2000;
const MAX_BUFFER = 30;
const ENDPOINT = "/api/client-trace";

const buffer: ClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushNow(viaBeacon: boolean): void {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  const payload = JSON.stringify({ events: batch });
  try {
    if (
      viaBeacon &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      navigator.sendBeacon(
        ENDPOINT,
        new Blob([payload], { type: "application/json" })
      );
      return;
    }
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* drop on network error; retry would duplicate events */
    });
  } catch {
    /* drop batch; never let tracing throw into the app */
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow(false);
  }, FLUSH_INTERVAL_MS);
}

export function clientTrace(
  event: string,
  data: Record<string, unknown> = {}
): void {
  const entry: ClientEvent = {
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  buffer.push(entry);
  try {
    console.log("[client-event]", entry);
  } catch {
    /* swallow */
  }
  if (buffer.length >= MAX_BUFFER) {
    flushNow(false);
  } else {
    scheduleFlush();
  }
}

// Flush on anything that would kill the tab before the debounce fires.
// pagehide is more reliable than beforeunload, and visibilitychange=hidden
// catches mobile + backgrounded tabs that browsers may not wake for pagehide.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flushNow(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow(true);
  });
}
