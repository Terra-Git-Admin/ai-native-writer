import { NextResponse } from "next/server";
import { checkPitchReadToken, getReadOnlyDb } from "@/lib/internal/pitchReadOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/pitches?limit=100&sort=created|updated
 * READ-ONLY. All writer stories (documents), newest first. Archived stories are INCLUDED and
 * flagged with `archived: true` so callers can label them.
 * Default order is by creation time (`sort=created`); `sort=updated` orders by last edit.
 * Auth: Authorization: Bearer $PITCH_READ_TOKEN. Never writes to writer.db.
 */
export async function GET(req: Request) {
  const gate = checkPitchReadToken(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const url = new URL(req.url);
  // Whitelisted column names only — never interpolate user input into SQL.
  const orderColumn =
    url.searchParams.get("sort") === "updated" ? "d.updated_at" : "d.created_at";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);

  try {
    const rows = getReadOnlyDb()
      .prepare(
        `SELECT d.id AS id, d.title AS title, d.orientation AS orientation,
                d.updated_at AS updatedAt, d.created_at AS createdAt, d.archived_at AS archivedAt, u.name AS ownerName
           FROM documents d
           LEFT JOIN users u ON u.id = d.owner_id
          ORDER BY ${orderColumn} DESC
          LIMIT ?`
      )
      .all(limit) as {
      id: string;
      title: string;
      orientation: string;
      updatedAt: number;
      createdAt: number;
      archivedAt: number | null;
      ownerName: string | null;
    }[];

    return NextResponse.json({
      pitches: rows.map((r) => ({
        id: r.id,
        title: r.title,
        orientation: r.orientation,
        ownerName: r.ownerName,
        archived: r.archivedAt != null,
        // Drizzle "timestamp" mode stores unix seconds.
        updatedAt: new Date(r.updatedAt * 1000).toISOString(),
        createdAt: new Date(r.createdAt * 1000).toISOString(),
      })),
    });
  } catch (err) {
    console.error("[internal/pitches] list failed", err);
    return NextResponse.json({ error: "Failed to read pitches" }, { status: 500 });
  }
}
