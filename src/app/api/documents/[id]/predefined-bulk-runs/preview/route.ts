import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPredefinedBulkPreview, PredefinedBulkError } from "@/lib/predefined-bulk/service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc || doc.ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const result = await getPredefinedBulkPreview(id);
    return NextResponse.json({
      plotTabId: result.plotTabId,
      predefinedTabId: result.predefinedTabId,
      preview: {
        eligible: result.preview.eligible.map(({ episodeNumber, title }) => ({ episodeNumber, title })),
        skipped: result.preview.skipped.map(({ episodeNumber, title }) => ({ episodeNumber, title })),
        issues: result.preview.issues,
        planHash: result.preview.planHash,
        aiStages: result.preview.eligible.length * 3,
      },
    });
  } catch (error) {
    if (error instanceof PredefinedBulkError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not build the bulk preview." }, { status: 500 });
  }
}
