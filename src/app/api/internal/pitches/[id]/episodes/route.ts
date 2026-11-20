import { NextResponse } from "next/server";
import { parsePredefinedEpisodes } from "@/lib/export/tiptap-parser";
import { checkPitchReadToken, getReadOnlyDb } from "@/lib/internal/pitchReadOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/pitches/:id/episodes
 * READ-ONLY. Episode list (number, title, beat count) parsed from the story's
 * `predefined_episodes` tab with the writer's own parser. No story text is returned.
 * Auth: Authorization: Bearer $PITCH_READ_TOKEN. Never writes to writer.db.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = checkPitchReadToken(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await params;

  try {
    const db = getReadOnlyDb();
    const doc = db
      .prepare("SELECT id, title, archived_at AS archivedAt FROM documents WHERE id = ?")
      .get(id) as { id: string; title: string; archivedAt: number | null } | undefined;
    if (!doc) {
      return NextResponse.json({ error: "Pitch not found" }, { status: 404 });
    }
    const tab = db
      .prepare(
        "SELECT content FROM tabs WHERE document_id = ? AND type = 'predefined_episodes' ORDER BY position LIMIT 1"
      )
      .get(id) as { content: string | null } | undefined;

    const episodes = parsePredefinedEpisodes(tab?.content ?? null).map((e) => ({
      episodeNumber: e.episodeNumber,
      title: e.title,
      beatCount: e.beats.length,
    }));
    return NextResponse.json({
      id: doc.id,
      title: doc.title,
      archived: doc.archivedAt != null,
      episodes,
    });
  } catch (err) {
    console.error("[internal/pitches] episodes failed", err);
    return NextResponse.json({ error: "Failed to read episodes" }, { status: 500 });
  }
}
