import type {
  PlotLabAction,
  PlotLabSessionPhase,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";

export class PlotLabActionPolicyError extends Error {
  readonly code: "SESSION_ARCHIVED" | "INVALID_PHASE" | "ACTION_IN_PROGRESS";

  constructor(
    code: "SESSION_ARCHIVED" | "INVALID_PHASE" | "ACTION_IN_PROGRESS",
    message: string
  ) {
    super(message);
    this.name = "PlotLabActionPolicyError";
    this.code = code;
  }
}

const ALLOWED_ACTIONS: Record<PlotLabSessionPhase, ReadonlySet<PlotLabAction["kind"]>> = {
  intake: new Set(["start", "restart"]),
  interview: new Set([
    "answer",
    "edit_answer",
    "add_context",
    "request_generation",
    "confirm_retcon",
    "continue_generation_with_snapshot",
    "restart",
  ]),
  queued: new Set(["restart"]),
  orchestrating: new Set(["restart"]),
  creative: new Set(["restart"]),
  reviewing: new Set(["restart"]),
  connecting: new Set(["restart"]),
  complete: new Set([
    "chat",
    "accept_output",
    "confirm_proposal",
    "regenerate_all",
    "regenerate_unit",
    "resolve_unit_candidate",
    "continue_generation_with_snapshot",
    "restart",
  ]),
  recoverable_error: new Set([
    "retry_failed_stage",
    "continue_generation_with_snapshot",
    "restart",
  ]),
};

export function isPlotLabActionAllowed(
  phase: PlotLabSessionPhase,
  actionKind: PlotLabAction["kind"]
): boolean {
  return ALLOWED_ACTIONS[phase].has(actionKind);
}

export function assertPlotLabActionAllowed(
  state: PlotLabSessionState,
  action: PlotLabAction
): void {
  if (state.status !== "active") {
    throw new PlotLabActionPolicyError("SESSION_ARCHIVED", "Archived Plot Lab sessions are read-only.");
  }
  if (!isPlotLabActionAllowed(state.phase, action.kind)) {
    throw new PlotLabActionPolicyError(
      "INVALID_PHASE",
      `${action.kind} is not allowed while the session is in ${state.phase}.`
    );
  }

  // Restart intentionally remains available while work is in flight. The
  // repository layer cancels/invalidates the old job or reservation before
  // archiving the session, and late commits fail their compare-and-swap.
  const replacesFailedJob =
    action.kind === "retry_failed_stage" &&
    state.phase === "recoverable_error" &&
    Boolean(state.activeJobId && state.failedStage);
  if (
    action.kind !== "restart" &&
    !replacesFailedJob &&
    (state.pendingSyncActionId || state.activeJobId)
  ) {
    throw new PlotLabActionPolicyError("ACTION_IN_PROGRESS", "Another Plot Lab mutation is in progress.");
  }
}
