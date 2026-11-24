import type {
  PlotLabActionEnvelope,
  PlotLabConnectedBatch,
  PlotLabGenerationStage,
  PlotLabMessage,
  PlotLabMutationProposal,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";

export type PlotLabActionStatus =
  | "reserved"
  | "awaiting_source_confirmation"
  | "queued"
  | "completed"
  | "failed";

export interface PlotLabActionRecord {
  id: string;
  actionId: string;
  documentId: string;
  sessionId: string;
  createdBy: string;
  requestHash: string;
  actionKind: PlotLabActionEnvelope["action"]["kind"];
  baseRevision: number;
  status: PlotLabActionStatus;
  request: PlotLabActionEnvelope;
  response?: Record<string, unknown>;
  jobId?: string;
  createdAt: string;
  completedAt?: string;
}

export type PlotLabActionReplayResult =
  | { kind: "new" }
  | { kind: "replay"; action: PlotLabActionRecord }
  | { kind: "scope_mismatch" }
  | { kind: "request_mismatch" };

export interface ReservePlotLabSyncActionInput {
  documentId: string;
  userId: string;
  isAdmin?: boolean;
  requestHash: string;
  envelope: PlotLabActionEnvelope;
  writerMessage?: Omit<PlotLabMessage, "sequence" | "createdAt">;
  startSnapshot?: Pick<
    PlotLabSessionState,
    "sourceSnapshot" | "sourceHashes" | "referenceSnapshots"
  >;
}

export interface ReservedPlotLabSyncAction {
  action: PlotLabActionRecord;
  session: PlotLabSessionState;
  immutableModelInput: Record<string, unknown>;
}

/**
 * Transaction-level persistence contract. Implementations must keep every
 * method atomic; callers must never compose the required compare-and-swap
 * from independent CRUD calls.
 */
export interface PlotLabRepository {
  findActionReplay(
    actionId: string,
    scope: { documentId: string; userId: string },
    requestHash: string
  ): Promise<PlotLabActionReplayResult>;

  getActiveSession(
    documentId: string,
    userId: string,
    isAdmin?: boolean
  ): Promise<PlotLabSessionState | null>;

  getSessionThread(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    sessionId?: string;
    includeSuperseded?: boolean;
    limit?: number;
    beforeSequence?: number;
  }): Promise<{ session: PlotLabSessionState; messages: PlotLabMessage[] }>;

  listSessionHistory(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    limit?: number;
    beforeArchivedAt?: string;
  }): Promise<PlotLabSessionState[]>;

  createIntakeSession(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    sessionId: string;
    orientation: PlotLabSessionState["orientation"];
  }): Promise<PlotLabSessionState>;

  reserveSynchronousAction(
    input: ReservePlotLabSyncActionInput
  ): Promise<ReservedPlotLabSyncAction>;

  finalizeSynchronousAction(input: {
    actionId: string;
    reservedRevision: number;
    leviMessages: Array<Omit<PlotLabMessage, "sequence" | "createdAt">>;
    sessionPatch: Partial<PlotLabSessionState>;
    response: Record<string, unknown>;
    supersedeFromMessageId?: string;
    proposal?: PlotLabMutationProposal;
  }): Promise<PlotLabSessionState>;

  failSynchronousAction(input: {
    actionId: string;
    reservedRevision: number;
    publicError: string;
  }): Promise<PlotLabSessionState>;

  queueGeneration(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    envelope: PlotLabActionEnvelope & {
      action: { kind: "request_generation" } | { kind: "retry_failed_stage"; jobId: string } | { kind: "confirm_proposal"; proposalId: string; downstreamChoice?: "update" | "keep" };
    };
    requestHash: string;
    jobId: string;
    modelId: string;
    thinking: boolean;
    inputSnapshot: Record<string, unknown>;
  }): Promise<{ session: PlotLabSessionState; jobId: string }>;

  startGenerationStage(input: {
    jobId: string;
    stage: PlotLabGenerationStage;
  }): Promise<PlotLabSessionState>;

  saveGenerationCheckpoint(input: {
    jobId: string;
    checkpoint: Record<string, unknown>;
  }): Promise<void>;

  completeGeneration(input: {
    jobId: string;
    batch: PlotLabConnectedBatch;
  }): Promise<PlotLabSessionState>;

  failGeneration(input: {
    jobId: string;
    stage: PlotLabGenerationStage;
    publicError: string;
  }): Promise<PlotLabSessionState>;

  restartSession(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    envelope: PlotLabActionEnvelope & { action: { kind: "restart" } };
    requestHash: string;
    replacementSessionId: string;
    orientation: PlotLabSessionState["orientation"];
    archivedAt: string;
  }): Promise<{ archivedSessionId: string; session: PlotLabSessionState }>;
}
