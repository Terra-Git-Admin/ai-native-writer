import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Client-side trace ingestion. The browser batches events and POSTs them here
// (or uses navigator.sendBeacon on page unload). Each event is logged as one
// line with a "[client-event]" prefix so Cloud Run log filters can pick them up.
//
// We deliberately keep this endpoint cheap: no DB writes, no blocking work,
// always returns 200. If auth is missing we still log the event but tag it
// anon — otherwise a user reproducing a bug right before a session expiry
// would silently lose the logs we need.

interface IncomingEvent {
  event?: unknown;
  ts?: unknown;
  [k: string]: unknown;
}

export async function POST(req: Request) {
  let payload: { events?: IncomingEvent[] } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) return NextResponse.json({ ok: true });

  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session?.user?.id ?? null;
  } catch {
    /* treat as anon */
  }

  const serverTs = new Date().toISOString();
  for (const evt of events) {
    try {
      const event =
        typeof evt?.event === "string" ? evt.event : "client.unknown";
      // Drop the event field from the spread so it doesn't overwrite our
      // top-level event key when the browser posted the same key.
      const { event: _e, ...rest } = evt as IncomingEvent;
      void _e;
      console.log(
        "[client-event] " +
          JSON.stringify({
            event,
            serverTs,
            userId,
            ...rest,
          })
      );
    } catch {
      /* ignore one bad event, keep draining the batch */
    }
  }

  return NextResponse.json({ ok: true });
}
