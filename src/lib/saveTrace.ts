// Structured server-side logger for the save/comment instrumentation.
// Gated by DEBUG_SAVE_TRACE=true so it stays dark in normal operation.
// Emits one JSON line per event — filterable in Cloud Run logs.

export function traceEnabled(): boolean {
  return process.env.DEBUG_SAVE_TRACE === "true";
}

export function seatbeltEnabled(): boolean {
  return process.env.DEBUG_SAVE_SEATBELT === "true";
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
    // never let a log failure affect the request path
  }
}

// Always-on warn: for events we want visible even when the trace flag is off
// (seatbelt firings, unexpected content shrinkage, etc.).
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
