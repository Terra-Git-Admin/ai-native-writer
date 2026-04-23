// Structured server-side logger for the save/comment instrumentation.
// Three tiers:
//   - logEvent:  ALWAYS ON. Use for critical lifecycle events (save start/ok/fail,
//                tab get/put, version created). Cost is trivial at current traffic
//                and we can never be blind to these again.
//   - logTrace:  env-gated by DEBUG_SAVE_TRACE=true. Use for high-volume or
//                keystroke-level events.
//   - warnTrace: ALWAYS ON via console.warn. Use for anomalies we want visible
//                even without structured log parsing.
// Every call emits one JSON line with a stable prefix so Cloud Run log filters
// by substring keep working.

export function traceEnabled(): boolean {
  return process.env.DEBUG_SAVE_TRACE === "true";
}

export function seatbeltEnabled(): boolean {
  return process.env.DEBUG_SAVE_SEATBELT === "true";
}

export function logEvent(
  event: string,
  data: Record<string, unknown> = {}
): void {
  try {
    console.log(
      "[save-event] " +
        JSON.stringify({
          event,
          ts: new Date().toISOString(),
          ...data,
        })
    );
  } catch {
    /* never let a log failure affect the request path */
  }
}

export function logTrace(
  event: string,
  data: Record<string, unknown> = {}
): void {
  if (!traceEnabled()) return;
  try {
    console.log(
      "[save-trace] " +
        JSON.stringify({
          event,
          ts: new Date().toISOString(),
          ...data,
        })
    );
  } catch {
    /* swallow */
  }
}

export function warnTrace(
  event: string,
  data: Record<string, unknown> = {}
): void {
  try {
    console.warn(
      "[save-warn] " +
        JSON.stringify({
          event,
          ts: new Date().toISOString(),
          ...data,
        })
    );
  } catch {
    /* swallow */
  }
}

// Safe content hash for correlating client and server views of a doc without
// logging the full JSON. Not cryptographic — djb2 is fine for correlation.
export function contentHash(s: string | null | undefined): string {
  if (!s) return "0";
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
