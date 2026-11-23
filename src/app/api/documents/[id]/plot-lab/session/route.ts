import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DrizzlePlotLabRepository } from "@/lib/plot-lab-v2/repository";
import { authorizePlotLabV2, plotLabErrorResponse } from "@/lib/plot-lab-v2/route-support";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id: documentId } = await params;
  const authorization = await authorizePlotLabV2(session, documentId);
  if (!authorization.ok) return authorization.response;

  try {
    const repository = new DrizzlePlotLabRepository(db);
    const active = await repository.getActiveSession(
      documentId,
      authorization.userId,
      authorization.isAdmin
    );
    if (!active) {
      return NextResponse.json({ session: null, messages: [] });
    }
    const thread = await repository.getSessionThread({
      documentId,
      userId: authorization.userId,
      isAdmin: authorization.isAdmin,
      limit: 50,
    });
    return NextResponse.json(thread);
  } catch (error) {
    return plotLabErrorResponse(error);
  }
}
