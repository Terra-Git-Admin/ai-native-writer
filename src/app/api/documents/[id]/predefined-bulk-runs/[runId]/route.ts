import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPredefinedBulkRun, PredefinedBulkError } from "@/lib/predefined-bulk/service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, runId } = await params;
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!doc || doc.ownerId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const run = await getPredefinedBulkRun(id, runId);
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof PredefinedBulkError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load bulk progress." }, { status: 500 });
  }
}
