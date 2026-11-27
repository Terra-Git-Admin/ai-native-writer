import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { retryPredefinedBulkRun, PredefinedBulkError } from "@/lib/predefined-bulk/service";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, runId } = await params;
  try {
    return NextResponse.json({ run: await retryPredefinedBulkRun(id, runId, session.user.id) });
  } catch (error) {
    if (error instanceof PredefinedBulkError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not resume bulk generation." }, { status: 500 });
  }
}
