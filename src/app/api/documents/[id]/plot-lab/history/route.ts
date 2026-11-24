import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DrizzlePlotLabRepository } from "@/lib/plot-lab-v2/repository";
import { authorizePlotLabV2, plotLabErrorResponse } from "@/lib/plot-lab-v2/route-support";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id: documentId } = await params;
  const authorization = await authorizePlotLabV2(session, documentId);
  if (!authorization.ok) return authorization.response;

  try {
    const url = new URL(request.url);
    const repository = new DrizzlePlotLabRepository(db);
    const sessionId = url.searchParams.get("sessionId");
    if (sessionId) {
      const beforeSequenceValue = url.searchParams.get("beforeSequence");
      const beforeSequence = beforeSequenceValue ? Number(beforeSequenceValue) : undefined;
      if (beforeSequence !== undefined && !Number.isInteger(beforeSequence)) {
        return NextResponse.json(
          { error: "beforeSequence must be an integer", code: "INVALID_CURSOR" },
          { status: 400 }
        );
      }
      const thread = await repository.getSessionThread({
        documentId,
        userId: authorization.userId,
        isAdmin: authorization.isAdmin,
        sessionId,
        includeSuperseded: true,
        beforeSequence,
        limit: 50,
      });
      return NextResponse.json(thread);
    }

    const sessions = await repository.listSessionHistory({
      documentId,
      userId: authorization.userId,
      isAdmin: authorization.isAdmin,
      beforeArchivedAt: url.searchParams.get("beforeArchivedAt") ?? undefined,
      limit: 20,
    });
    return NextResponse.json({ sessions });
  } catch (error) {
    return plotLabErrorResponse(error);
  }
}
