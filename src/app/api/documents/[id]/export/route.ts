import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildExport } from "@/lib/export/writer-export";
import { logEvent } from "@/lib/saveTrace";

function getPublicBaseUrl(req: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(req.url).origin;
}

// POST /api/documents/[id]/export
// Creates a handoff export link for a document. Auth required, owner/admin only.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startedAt = Date.now();
  logEvent("export.route.start", {
    docId: id,
    userId: session.user.id,
    mode: "last_saved_no_flush",
  });

  try {
    const result = await buildExport(
      id,
      doc.title,
      session.user.id,
      getPublicBaseUrl(req)
    );

    logEvent("export.route.ok", {
      docId: id,
      userId: session.user.id,
      exportId: result.exportId,
      mode: "last_saved_no_flush",
      elapsedMs: Date.now() - startedAt,
      tabCount: result.export.tabs.length,
      payloadBytes: JSON.stringify(result.export).length,
      latestTabUpdatedAt: result.export.tabs.reduce<string | null>(
        (latest, tab) =>
          !latest || tab.updatedAt > latest ? tab.updatedAt : latest,
        null
      ),
    });

    return NextResponse.json({
      exportId: result.exportId,
      exportUrl: result.exportUrl,
      preview: {
        hasTitle: result.export.series.title.trim().length > 0,
        episodes: result.export.episodes.length,
        characters: result.export.characters.length,
        locations: result.export.locations.length,
        hasSummary: result.export.series.summary.trim().length > 0,
        hasLogline: result.export.series.logline.trim().length > 0,
      },
    });
  } catch (err) {
    logEvent("export.route.fail", {
      docId: id,
      userId: session.user.id,
      mode: "last_saved_no_flush",
      elapsedMs: Date.now() - startedAt,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
