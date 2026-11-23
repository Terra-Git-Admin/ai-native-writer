import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  executeMockPlotLabAction,
  parsePlotLabActionEnvelope,
} from "@/lib/plot-lab-v2/action-service";
import { DrizzlePlotLabRepository } from "@/lib/plot-lab-v2/repository";
import { authorizePlotLabV2, plotLabErrorResponse } from "@/lib/plot-lab-v2/route-support";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id: documentId } = await params;
  const authorization = await authorizePlotLabV2(session, documentId);
  if (!authorization.ok) return authorization.response;

  try {
    const body = await request.json().catch(() => null);
    const envelope = parsePlotLabActionEnvelope(body);
    const result = await executeMockPlotLabAction({
      database: db,
      repository: new DrizzlePlotLabRepository(db),
      documentId,
      userId: authorization.userId,
      isAdmin: authorization.isAdmin,
      envelope,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
    if (
      code === "SESSION_STALE" ||
      code === "ACTION_IN_PROGRESS" ||
      code === "AI_RESPONSE_FAILED"
    ) {
      try {
        const canonical = await new DrizzlePlotLabRepository(db).getSessionThread({
          documentId,
          userId: authorization.userId,
          isAdmin: authorization.isAdmin,
          limit: 50,
        });
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "The Plot Lab session changed.",
            code,
            canonical,
          },
          { status: code === "AI_RESPONSE_FAILED" ? 502 : 409 }
        );
      } catch {
        // Fall through to the ordinary typed error response if no active session exists.
      }
    }
    return plotLabErrorResponse(error);
  }
}
