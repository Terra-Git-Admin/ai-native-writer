import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildExport } from "@/lib/export/writer-export";

// POST /api/documents/[id]/export
// Creates a handoff export link for a document. Auth required, owner/admin only.
export async function POST(
  _req: Request,
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

  const result = await buildExport(id, doc.title, session.user.id);

  return NextResponse.json({
    exportId: result.exportId,
    exportUrl: result.exportUrl,
    preview: {
      episodes: result.export.episodes.length,
      characters: result.export.characters.length,
      locations: result.export.locations.length,
    },
  });
}
