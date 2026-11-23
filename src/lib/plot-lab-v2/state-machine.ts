import type {
  PlotLabGenerationStage,
  PlotLabSessionPhase,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";
import type { DocumentOrientation } from "@/lib/document-orientation";

export class PlotLabTransitionError extends Error {
  readonly code:
    | "SESSION_ARCHIVED"
    | "SESSION_STALE"
    | "INVALID_PHASE"
    | "ACTION_IN_PROGRESS"
    | "JOB_MISMATCH";

  constructor(
    code:
      | "SESSION_ARCHIVED"
      | "SESSION_STALE"
      | "INVALID_PHASE"
      | "ACTION_IN_PROGRESS"
      | "JOB_MISMATCH",
    message: string
  ) {
    super(message);
    this.name = "PlotLabTransitionError";
    this.code = code;
  }
}

export type PlotLabStateEvent =
  | { type: "session_started"; seed: string }
  | { type: "sync_action_reserved"; actionId: string }
  | { type: "sync_action_finalized"; actionId: string }
  | { type: "sync_action_failed"; actionId: string }
  | { type: "generation_queued"; jobId: string }
  | { type: "job_stage_started"; jobId: string; stage: PlotLabGenerationStage }
  | { type: "job_stage_failed"; jobId: string; stage: PlotLabGenerationStage }
  | { type: "job_completed"; jobId: string; outputVersion: number }
  | { type: "job_cancelled"; jobId: string }
  | { type: "session_archived"; archivedAt: string };

const GENERATION_PHASES = new Set<PlotLabSessionPhase>([
  "queued",
  "creative",
  "connecting",
  "recoverable_error",
]);

export interface CreatePlotLabSessionInput {
  sessionId: string;
  documentId: string;
  createdBy: string;
  orientation: DocumentOrientation;
  trainingPackVersion?: string;
}

export function createPlotLabIntakeSession(
  input: CreatePlotLabSessionInput
): PlotLabSessionState {
  return {
    sessionId: input.sessionId,
    documentId: input.documentId,
    createdBy: input.createdBy,
    status: "active",
    phase: "intake",
    revision: 0,
    orientation: input.orientation,
    referenceSnapshots: [],
    interviewCheckpoint: {
      creativeQuestionCount: 0,
      readyForCreative: false,
    },
    confirmedRetcons: [],
    promptVersions: {},
    modelAssignments: {},
    trainingPackVersion: input.trainingPackVersion ?? "unassigned",
  };
}

export function assertPlotLabRevision(
  state: PlotLabSessionState,
  expectedRevision: number
): void {
  if (state.revision !== expectedRevision) {
    throw new PlotLabTransitionError(
      "SESSION_STALE",
      `Expected Plot Lab revision ${expectedRevision}, but the current revision is ${state.revision}.`
    );
  }
}

function assertActive(state: PlotLabSessionState): void {
  if (state.status !== "active") {
    throw new PlotLabTransitionError("SESSION_ARCHIVED", "Archived Plot Lab sessions are read-only.");
  }
}

function assertPhase(
  state: PlotLabSessionState,
  allowed: PlotLabSessionPhase[],
  event: PlotLabStateEvent["type"]
): void {
  if (!allowed.includes(state.phase)) {
    throw new PlotLabTransitionError(
      "INVALID_PHASE",
      `${event} is not allowed while the session is in ${state.phase}.`
    );
  }
}

function assertJob(state: PlotLabSessionState, jobId: string): void {
  if (state.activeJobId !== jobId) {
    throw new PlotLabTransitionError(
      "JOB_MISMATCH",
      `Job ${jobId} is not the session's active job.`
    );
  }
}

function nextRevision(state: PlotLabSessionState): number {
  return state.revision + 1;
}

export function transitionPlotLabSession(
  state: PlotLabSessionState,
  event: PlotLabStateEvent
): PlotLabSessionState {
  if (event.type === "session_archived") {
    assertActive(state);
    return {
      ...state,
      status: "archived",
      revision: nextRevision(state),
      activeJobId: undefined,
      pendingSyncActionId: undefined,
      archivedAt: event.archivedAt,
    };
  }

  assertActive(state);

  switch (event.type) {
    case "session_started":
      assertPhase(state, ["intake"], event.type);
      if (!event.seed.trim()) {
        throw new PlotLabTransitionError("INVALID_PHASE", "A non-empty seed is required to start Plot Lab.");
      }
      return {
        ...state,
        phase: "interview",
        seed: event.seed.trim(),
        revision: nextRevision(state),
      };

    case "sync_action_reserved":
      assertPhase(state, ["interview", "complete"], event.type);
      if (state.pendingSyncActionId) {
        throw new PlotLabTransitionError(
          "ACTION_IN_PROGRESS",
          `Synchronous action ${state.pendingSyncActionId} is already in progress.`
        );
      }
      if (state.activeJobId) {
        throw new PlotLabTransitionError("ACTION_IN_PROGRESS", "A generation job is already in progress.");
      }
      return {
        ...state,
        revision: nextRevision(state),
        pendingSyncActionId: event.actionId,
      };

    case "sync_action_finalized":
    case "sync_action_failed":
      if (state.pendingSyncActionId !== event.actionId) {
        throw new PlotLabTransitionError(
          "ACTION_IN_PROGRESS",
          `Synchronous action ${event.actionId} does not own the current reservation.`
        );
      }
      return {
        ...state,
        revision: nextRevision(state),
        pendingSyncActionId: undefined,
      };

    case "generation_queued":
      assertPhase(state, ["interview", "complete", "recoverable_error"], event.type);
      const replacesFailedJob =
        state.phase === "recoverable_error" &&
        Boolean(state.activeJobId && state.failedStage);
      if (state.pendingSyncActionId || (state.activeJobId && !replacesFailedJob)) {
        throw new PlotLabTransitionError("ACTION_IN_PROGRESS", "Another Plot Lab mutation is in progress.");
      }
      return {
        ...state,
        phase: "queued",
        revision: nextRevision(state),
        activeJobId: event.jobId,
        failedStage: undefined,
      };

    case "job_stage_started": {
      assertJob(state, event.jobId);
      const allowedPhases: PlotLabSessionPhase[] =
        event.stage === "creative" || event.stage === "unit_creative"
          ? ["queued", "recoverable_error"]
          : ["creative", "recoverable_error"];
      assertPhase(state, allowedPhases, event.type);
      const phase: PlotLabSessionPhase =
        event.stage === "creative" || event.stage === "unit_creative"
          ? "creative"
          : "connecting";
      return {
        ...state,
        phase,
        revision: nextRevision(state),
        failedStage: undefined,
      };
    }

    case "job_stage_failed":
      assertJob(state, event.jobId);
      assertPhase(state, [...GENERATION_PHASES], event.type);
      return {
        ...state,
        phase: "recoverable_error",
        revision: nextRevision(state),
        failedStage: event.stage,
      };

    case "job_completed":
      assertJob(state, event.jobId);
      assertPhase(state, ["connecting"], event.type);
      if (event.outputVersion < 1 || event.outputVersion <= (state.latestOutputVersion ?? 0)) {
        throw new PlotLabTransitionError(
          "INVALID_PHASE",
          "A completed output version must be newer than the current output."
        );
      }
      return {
        ...state,
        phase: "complete",
        revision: nextRevision(state),
        activeJobId: undefined,
        failedStage: undefined,
        latestOutputVersion: event.outputVersion,
      };

    case "job_cancelled":
      assertJob(state, event.jobId);
      assertPhase(state, [...GENERATION_PHASES], event.type);
      return {
        ...state,
        phase: state.latestOutputVersion ? "complete" : "interview",
        revision: nextRevision(state),
        activeJobId: undefined,
        failedStage: undefined,
      };
  }
}
