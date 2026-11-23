import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getPlotLabAccess, isPlotLabV2Enabled } from "@/lib/plot-lab/access";
import { PlotLabActionServiceError } from "@/lib/plot-lab-v2/action-service";
import { PlotLabActionPolicyError } from "@/lib/plot-lab-v2/action-policy";
import { PlotLabRepositoryError } from "@/lib/plot-lab-v2/repository";
import { PlotLabSnapshotError } from "@/lib/plot-lab-v2/source-snapshot";
import { PlotLabTransitionError } from "@/lib/plot-lab-v2/state-machine";

export async function authorizePlotLabV2(
  session: Session | null,
  documentId: string
): Promise<
  | { ok: true; userId: string; isAdmin: boolean }
  | { ok: false; response: NextResponse }
> {
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isPlotLabV2Enabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Plot Lab V2 is disabled", code: "PLOT_LAB_V2_DISABLED" },
        { status: 404 }
      ),
    };
  }
  const access = await getPlotLabAccess(session, { documentId });
  if (!access.canUsePlotLab) {
    const status = access.reason === "document_not_found" ? 404 : 403;
    return {
      ok: false,
      response: NextResponse.json({ error: "Plot Lab access denied", code: access.reason }, { status }),
    };
  }
  return { ok: true, userId: session.user.id, isAdmin: access.reason === "admin" };
}

export function plotLabErrorResponse(error: unknown): NextResponse {
  if (error instanceof PlotLabActionServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof PlotLabSnapshotError) {
    const status = error.code === "DOCUMENT_NOT_FOUND" ? 404 : 422;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (
    error instanceof PlotLabRepositoryError ||
    error instanceof PlotLabTransitionError ||
    error instanceof PlotLabActionPolicyError
  ) {
    const code = error.code;
    const status =
      code === "ACCESS_DENIED"
        ? 403
        : code === "SESSION_NOT_FOUND"
          ? 404
          : code === "ACTION_IN_PROGRESS" ||
              code === "SESSION_STALE" ||
              code === "ACTION_ALREADY_EXISTS" ||
              code === "ACTION_SCOPE_MISMATCH" ||
              code === "ACTION_REQUEST_MISMATCH"
            ? 409
            : 422;
    return NextResponse.json({ error: error.message, code }, { status });
  }
  return NextResponse.json(
    { error: "Plot Lab could not complete the request", code: "PLOT_LAB_INTERNAL_ERROR" },
    { status: 500 }
  );
}
