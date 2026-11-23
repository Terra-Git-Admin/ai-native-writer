import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import {
  aiJobs,
  documents,
  plotLabActions,
  plotLabMessages,
  plotLabOutputs,
  plotLabProposals,
  plotLabSessions,
} from "../db/schema";
import type {
  PlotLabActionEnvelope,
  PlotLabConnectedBatch,
  PlotLabGenerationStage,
  PlotLabMessage,
  PlotLabMutationProposal,
  PlotLabSessionState,
} from "./contracts";
import type {
  PlotLabActionRecord,
  PlotLabActionReplayResult,
  PlotLabRepository,
  ReservePlotLabSyncActionInput,
  ReservedPlotLabSyncAction,
} from "./repository-contract";
import { assertPlotLabActionAllowed } from "./action-policy";
import {
  assertPlotLabRevision,
  createPlotLabIntakeSession,
  transitionPlotLabSession,
} from "./state-machine";

type Database = BetterSQLite3Database<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbExecutor = Database | Transaction;
type SessionRow = typeof plotLabSessions.$inferSelect;
type ActionRow = typeof plotLabActions.$inferSelect;

export class PlotLabRepositoryError extends Error {
  readonly code:
    | "ACCESS_DENIED"
    | "ACTION_ALREADY_EXISTS"
    | "ACTION_NOT_FOUND"
    | "ACTION_SCOPE_MISMATCH"
    | "ACTION_REQUEST_MISMATCH"
    | "ACTION_NOT_RESERVED"
    | "SESSION_NOT_FOUND"
    | "SESSION_STALE";

  constructor(code: PlotLabRepositoryError["code"], message: string) {
    super(message);
    this.name = "PlotLabRepositoryError";
    this.code = code;
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

function toIso(value: Date | null): string | undefined {
  return value?.toISOString();
}

function toSession(row: SessionRow): PlotLabSessionState {
  return {
    sessionId: row.id,
    documentId: row.documentId,
    createdBy: row.createdBy,
    status: row.status,
    phase: row.phase,
    revision: row.revision,
    orientation: row.orientation,
    sourceSnapshot: parseJson(row.sourceSnapshotJson, undefined),
    sourceHashes: parseJson(row.sourceHashesJson, undefined),
    seed: row.seed ?? undefined,
    referenceSnapshots: parseJson(row.referencesJson, []),
    interviewCheckpoint: parseJson(row.interviewCheckpointJson, {
      creativeQuestionCount: 0,
      readyForCreative: false,
    }),
    confirmedRetcons: parseJson(row.retconsJson, []),
    latestOutputVersion: row.latestOutputVersion ?? undefined,
    activeJobId: row.activeJobId ?? undefined,
    pendingSyncActionId: row.pendingSyncActionId ?? undefined,
    failedStage: row.failedStage ?? undefined,
    promptVersions: parseJson(row.promptVersionsJson, {}),
    modelAssignments: parseJson(row.modelAssignmentsJson, {}),
    trainingPackVersion: row.trainingPackVersion,
    archivedAt: toIso(row.archivedAt),
  };
}

function toAction(row: ActionRow): PlotLabActionRecord {
  return {
    id: row.id,
    actionId: row.actionId,
    documentId: row.documentId,
    sessionId: row.sessionId,
    createdBy: row.createdBy,
    requestHash: row.requestHash,
    actionKind: row.actionKind as PlotLabActionRecord["actionKind"],
    baseRevision: row.baseRevision,
    status: row.status,
    request: parseJson<PlotLabActionEnvelope>(row.requestJson, {
      actionId: row.actionId,
      expectedRevision: row.baseRevision,
      action: { kind: "restart" },
    }),
    response: parseJson(row.responseJson, undefined),
    jobId: row.jobId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    completedAt: toIso(row.completedAt),
  };
}

function toMessage(row: typeof plotLabMessages.$inferSelect): PlotLabMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    role: row.role,
    kind: row.kind,
    content: row.content,
    payload: parseJson(row.payloadJson, undefined),
    actionId: row.actionId ?? undefined,
    parentMessageId: row.parentMessageId ?? undefined,
    dependencyIds: parseJson(row.dependencyIdsJson, []),
    replayScope: row.replayScope,
    supersededAt: toIso(row.supersededAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function sessionInsertValues(state: PlotLabSessionState, now: Date) {
  return {
    id: state.sessionId,
    documentId: state.documentId,
    createdBy: state.createdBy,
    status: state.status,
    phase: state.phase,
    revision: state.revision,
    orientation: state.orientation,
    seed: state.seed ?? null,
    sourceSnapshotJson: state.sourceSnapshot ? JSON.stringify(state.sourceSnapshot) : null,
    sourceHashesJson: state.sourceHashes ? JSON.stringify(state.sourceHashes) : null,
    referencesJson: JSON.stringify(state.referenceSnapshots),
    interviewCheckpointJson: JSON.stringify(state.interviewCheckpoint),
    retconsJson: JSON.stringify(state.confirmedRetcons),
    latestOutputVersion: state.latestOutputVersion ?? null,
    activeJobId: state.activeJobId ?? null,
    pendingSyncActionId: state.pendingSyncActionId ?? null,
    failedStage: state.failedStage ?? null,
    promptVersionsJson: JSON.stringify(state.promptVersions),
    modelAssignmentsJson: JSON.stringify(state.modelAssignments),
    trainingPackVersion: state.trainingPackVersion,
    createdAt: now,
    updatedAt: now,
    archivedAt: state.archivedAt ? new Date(state.archivedAt) : null,
  };
}

function mutableSessionValues(state: PlotLabSessionState, now: Date) {
  return {
    status: state.status,
    phase: state.phase,
    revision: state.revision,
    orientation: state.orientation,
    seed: state.seed ?? null,
    sourceSnapshotJson: state.sourceSnapshot ? JSON.stringify(state.sourceSnapshot) : null,
    sourceHashesJson: state.sourceHashes ? JSON.stringify(state.sourceHashes) : null,
    referencesJson: JSON.stringify(state.referenceSnapshots),
    interviewCheckpointJson: JSON.stringify(state.interviewCheckpoint),
    retconsJson: JSON.stringify(state.confirmedRetcons),
    latestOutputVersion: state.latestOutputVersion ?? null,
    activeJobId: state.activeJobId ?? null,
    pendingSyncActionId: state.pendingSyncActionId ?? null,
    failedStage: state.failedStage ?? null,
    promptVersionsJson: JSON.stringify(state.promptVersions),
    modelAssignmentsJson: JSON.stringify(state.modelAssignments),
    trainingPackVersion: state.trainingPackVersion,
    updatedAt: now,
    archivedAt: state.archivedAt ? new Date(state.archivedAt) : null,
  };
}

function nextMessageSequence(tx: DbExecutor, sessionId: string): number {
  const latest = tx
    .select({ sequence: plotLabMessages.sequence })
    .from(plotLabMessages)
    .where(eq(plotLabMessages.sessionId, sessionId))
    .orderBy(plotLabMessages.sequence)
    .all()
    .at(-1);
  return (latest?.sequence ?? 0) + 1;
}

function insertMessages(
  tx: DbExecutor,
  sessionId: string,
  messages: Array<Omit<PlotLabMessage, "sequence" | "createdAt">>,
  now: Date
): void {
  let sequence = nextMessageSequence(tx, sessionId);
  for (const message of messages) {
    tx.insert(plotLabMessages)
      .values({
        id: message.id,
        sessionId,
        sequence,
        role: message.role,
        kind: message.kind,
        content: message.content,
        payloadJson: message.payload ? JSON.stringify(message.payload) : null,
        actionId: message.actionId ?? null,
        parentMessageId: message.parentMessageId ?? null,
        dependencyIdsJson: JSON.stringify(message.dependencyIds),
        replayScope: message.replayScope,
        supersededAt: message.supersededAt ? new Date(message.supersededAt) : null,
        createdAt: now,
      })
      .run();
    sequence += 1;
  }
}

function requireDocumentAccess(
  tx: DbExecutor,
  documentId: string,
  userId: string,
  isAdmin = false
): void {
  const document = tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      isAdmin
        ? eq(documents.id, documentId)
        : and(eq(documents.id, documentId), eq(documents.ownerId, userId))
    )
    .get();
  if (!document) {
    throw new PlotLabRepositoryError("ACCESS_DENIED", "The document is not available to this user.");
  }
}

function supersedeDerivedMessageGraph(
  tx: DbExecutor,
  sessionId: string,
  rootMessageId: string,
  now: Date
): void {
  const rows = tx
    .select()
    .from(plotLabMessages)
    .where(and(eq(plotLabMessages.sessionId, sessionId), isNull(plotLabMessages.supersededAt)))
    .all();
  const superseded = new Set<string>([rootMessageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (superseded.has(row.id) || row.replayScope !== "derived") continue;
      const dependencies = parseJson<string[]>(row.dependencyIdsJson, []);
      if (
        (row.parentMessageId && superseded.has(row.parentMessageId)) ||
        dependencies.some((id) => superseded.has(id))
      ) {
        superseded.add(row.id);
        changed = true;
      }
    }
  }
  if (superseded.size > 0) {
    tx.update(plotLabMessages)
      .set({ supersededAt: now })
      .where(
        and(
          eq(plotLabMessages.sessionId, sessionId),
          inArray(plotLabMessages.id, [...superseded]),
          isNull(plotLabMessages.supersededAt)
        )
      )
      .run();
  }
}

function activeSessionRow(tx: DbExecutor, documentId: string): SessionRow | undefined {
  return tx
    .select()
    .from(plotLabSessions)
    .where(
      and(eq(plotLabSessions.documentId, documentId), eq(plotLabSessions.status, "active"))
    )
    .get();
}

function requireReservedAction(tx: DbExecutor, actionId: string): ActionRow {
  const action = tx
    .select()
    .from(plotLabActions)
    .where(eq(plotLabActions.actionId, actionId))
    .get();
  if (!action) {
    throw new PlotLabRepositoryError("ACTION_NOT_FOUND", "The Plot Lab action does not exist.");
  }
  if (action.status !== "reserved") {
    throw new PlotLabRepositoryError("ACTION_NOT_RESERVED", "The Plot Lab action is no longer reserved.");
  }
  return action;
}

function replayResult(
  row: ActionRow | undefined,
  scope: { documentId: string; userId: string },
  requestHash: string
): PlotLabActionReplayResult {
  if (!row) return { kind: "new" };
  if (row.documentId !== scope.documentId || row.createdBy !== scope.userId) {
    return { kind: "scope_mismatch" };
  }
  if (row.requestHash !== requestHash) return { kind: "request_mismatch" };
  return { kind: "replay", action: toAction(row) };
}

export class DrizzlePlotLabRepository implements PlotLabRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async findActionReplay(
    actionId: string,
    scope: { documentId: string; userId: string },
    requestHash: string
  ): Promise<PlotLabActionReplayResult> {
    const row = this.database
      .select()
      .from(plotLabActions)
      .where(eq(plotLabActions.actionId, actionId))
      .get();
    return replayResult(row, scope, requestHash);
  }

  async getActiveSession(
    documentId: string,
    userId: string,
    isAdmin = false
  ): Promise<PlotLabSessionState | null> {
    requireDocumentAccess(this.database, documentId, userId, isAdmin);
    const row = activeSessionRow(this.database, documentId);
    return row ? toSession(row) : null;
  }

  async getSessionThread(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    sessionId?: string;
    includeSuperseded?: boolean;
    limit?: number;
    beforeSequence?: number;
  }): Promise<{ session: PlotLabSessionState; messages: PlotLabMessage[] }> {
    requireDocumentAccess(this.database, input.documentId, input.userId, input.isAdmin);
    const sessionRow = input.sessionId
      ? this.database
          .select()
          .from(plotLabSessions)
          .where(
            and(
              eq(plotLabSessions.id, input.sessionId),
              eq(plotLabSessions.documentId, input.documentId)
            )
          )
          .get()
      : activeSessionRow(this.database, input.documentId);
    if (!sessionRow) {
      throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The Plot Lab session does not exist.");
    }
    const filters = [eq(plotLabMessages.sessionId, sessionRow.id)];
    if (!input.includeSuperseded) filters.push(isNull(plotLabMessages.supersededAt));
    if (input.beforeSequence !== undefined) {
      filters.push(lt(plotLabMessages.sequence, input.beforeSequence));
    }
    const rows = this.database
      .select()
      .from(plotLabMessages)
      .where(and(...filters))
      .orderBy(desc(plotLabMessages.sequence))
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 100))
      .all()
      .reverse();
    return { session: toSession(sessionRow), messages: rows.map(toMessage) };
  }

  async listSessionHistory(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    limit?: number;
    beforeArchivedAt?: string;
  }): Promise<PlotLabSessionState[]> {
    requireDocumentAccess(this.database, input.documentId, input.userId, input.isAdmin);
    const filters = [
      eq(plotLabSessions.documentId, input.documentId),
      eq(plotLabSessions.status, "archived" as const),
    ];
    if (input.beforeArchivedAt) {
      filters.push(lt(plotLabSessions.archivedAt, new Date(input.beforeArchivedAt)));
    }
    return this.database
      .select()
      .from(plotLabSessions)
      .where(and(...filters))
      .orderBy(desc(plotLabSessions.archivedAt))
      .limit(Math.min(Math.max(input.limit ?? 20, 1), 50))
      .all()
      .map(toSession);
  }

  async createIntakeSession(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    sessionId: string;
    orientation: PlotLabSessionState["orientation"];
  }): Promise<PlotLabSessionState> {
    return this.database.transaction((tx) => {
      requireDocumentAccess(tx, input.documentId, input.userId, input.isAdmin);
      if (activeSessionRow(tx, input.documentId)) {
        throw new PlotLabRepositoryError(
          "SESSION_STALE",
          "The document already has an active Plot Lab session."
        );
      }
      const state = createPlotLabIntakeSession({
        sessionId: input.sessionId,
        documentId: input.documentId,
        createdBy: input.userId,
        orientation: input.orientation,
      });
      tx.insert(plotLabSessions).values(sessionInsertValues(state, new Date())).run();
      return state;
    });
  }

  async reserveSynchronousAction(
    input: ReservePlotLabSyncActionInput
  ): Promise<ReservedPlotLabSyncAction> {
    return this.database.transaction((tx) => {
      requireDocumentAccess(tx, input.documentId, input.userId, input.isAdmin);
      const existing = tx
        .select()
        .from(plotLabActions)
        .where(eq(plotLabActions.actionId, input.envelope.actionId))
        .get();
      if (existing) {
        throw new PlotLabRepositoryError(
          "ACTION_ALREADY_EXISTS",
          "This Plot Lab action ID has already been used."
        );
      }
      const row = activeSessionRow(tx, input.documentId);
      if (!row) {
        throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "No active Plot Lab session exists.");
      }
      const state = toSession(row);
      assertPlotLabRevision(state, input.envelope.expectedRevision);
      assertPlotLabActionAllowed(state, input.envelope.action);
      const started =
        input.envelope.action.kind === "start"
          ? transitionPlotLabSession(state, {
              type: "session_started",
              seed: input.envelope.action.seed,
            })
          : state;
      const snapshotted =
        input.envelope.action.kind === "start" && input.startSnapshot
          ? { ...started, ...input.startSnapshot }
          : started;
      const reserved = transitionPlotLabSession(snapshotted, {
        type: "sync_action_reserved",
        actionId: input.envelope.actionId,
      });
      const now = new Date();

      tx.insert(plotLabActions)
        .values({
          id: input.envelope.actionId,
          actionId: input.envelope.actionId,
          documentId: input.documentId,
          sessionId: state.sessionId,
          createdBy: input.userId,
          requestHash: input.requestHash,
          actionKind: input.envelope.action.kind,
          baseRevision: input.envelope.expectedRevision,
          status: "reserved",
          requestJson: JSON.stringify(input.envelope),
          createdAt: now,
        })
        .run();
      if (input.writerMessage) {
        insertMessages(tx, state.sessionId, [input.writerMessage], now);
      }
      const update = tx
        .update(plotLabSessions)
        .set(mutableSessionValues(reserved, now))
        .where(
          and(
            eq(plotLabSessions.id, state.sessionId),
            eq(plotLabSessions.status, "active"),
            eq(plotLabSessions.revision, input.envelope.expectedRevision)
          )
        )
        .run();
      if (update.changes !== 1) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab session changed.");
      }

      return {
        action: toAction(
          tx
            .select()
            .from(plotLabActions)
            .where(eq(plotLabActions.actionId, input.envelope.actionId))
            .get()!
        ),
        session: reserved,
        immutableModelInput: {
          sessionId: reserved.sessionId,
          revision: reserved.revision,
          orientation: reserved.orientation,
          seed: reserved.seed,
          sourceSnapshot: reserved.sourceSnapshot,
          referenceSnapshots: reserved.referenceSnapshots,
          interviewCheckpoint: reserved.interviewCheckpoint,
          confirmedRetcons: reserved.confirmedRetcons,
          promptVersions: reserved.promptVersions,
          modelAssignments: reserved.modelAssignments,
          trainingPackVersion: reserved.trainingPackVersion,
          action: input.envelope.action,
        },
      };
    });
  }

  async finalizeSynchronousAction(input: {
    actionId: string;
    reservedRevision: number;
    leviMessages: Array<Omit<PlotLabMessage, "sequence" | "createdAt">>;
    sessionPatch: Partial<PlotLabSessionState>;
    response: Record<string, unknown>;
    supersedeFromMessageId?: string;
    proposal?: PlotLabMutationProposal;
  }): Promise<PlotLabSessionState> {
    return this.database.transaction((tx) => {
      const action = requireReservedAction(tx, input.actionId);
      const row = tx
        .select()
        .from(plotLabSessions)
        .where(eq(plotLabSessions.id, action.sessionId))
        .get();
      if (!row) {
        throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The Plot Lab session no longer exists.");
      }
      const state = toSession(row);
      if (state.revision !== input.reservedRevision) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab reservation is stale.");
      }
      const patched = { ...state, ...input.sessionPatch, revision: state.revision };
      const finalized = transitionPlotLabSession(patched, {
        type: "sync_action_finalized",
        actionId: input.actionId,
      });
      const now = new Date();
      if (input.supersedeFromMessageId) {
        supersedeDerivedMessageGraph(tx, state.sessionId, input.supersedeFromMessageId, now);
      }
      insertMessages(tx, state.sessionId, input.leviMessages, now);
      if (input.proposal) {
        tx.insert(plotLabProposals).values({
          id: input.proposal.id,
          sessionId: input.proposal.sessionId,
          sourceMessageId: input.proposal.sourceMessageId,
          baseOutputVersion: input.proposal.baseOutputVersion,
          instruction: input.proposal.instruction,
          targetUnitsJson: JSON.stringify(input.proposal.targetUnitNumbers),
          downstreamUnitsJson: JSON.stringify(input.proposal.downstreamUnitNumbers),
          explanation: input.proposal.explanation,
          status: input.proposal.status,
          confirmedChoice: input.proposal.confirmedChoice ?? null,
          createdAt: now,
          resolvedAt: null,
        }).run();
      }
      const update = tx
        .update(plotLabSessions)
        .set(mutableSessionValues(finalized, now))
        .where(
          and(
            eq(plotLabSessions.id, state.sessionId),
            eq(plotLabSessions.status, "active"),
            eq(plotLabSessions.revision, input.reservedRevision),
            eq(plotLabSessions.pendingSyncActionId, input.actionId)
          )
        )
        .run();
      if (update.changes !== 1) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab reservation was lost.");
      }
      tx.update(plotLabActions)
        .set({
          status: "completed",
          responseJson: JSON.stringify(input.response),
          completedAt: now,
        })
        .where(and(eq(plotLabActions.id, action.id), eq(plotLabActions.status, "reserved")))
        .run();
      return finalized;
    });
  }

  async failSynchronousAction(input: {
    actionId: string;
    reservedRevision: number;
    publicError: string;
  }): Promise<PlotLabSessionState> {
    return this.database.transaction((tx) => {
      const action = requireReservedAction(tx, input.actionId);
      const row = tx
        .select()
        .from(plotLabSessions)
        .where(eq(plotLabSessions.id, action.sessionId))
        .get();
      if (!row) {
        throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The Plot Lab session no longer exists.");
      }
      const state = toSession(row);
      if (state.revision !== input.reservedRevision) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab reservation is stale.");
      }
      const failed = transitionPlotLabSession(state, {
        type: "sync_action_failed",
        actionId: input.actionId,
      });
      const now = new Date();
      insertMessages(
        tx,
        state.sessionId,
        [
          {
            id: `${input.actionId}:error`,
            sessionId: state.sessionId,
            role: "system",
            kind: "error",
            content: input.publicError,
            actionId: input.actionId,
            dependencyIds: [],
            replayScope: "derived",
          },
        ],
        now
      );
      const update = tx
        .update(plotLabSessions)
        .set(mutableSessionValues(failed, now))
        .where(
          and(
            eq(plotLabSessions.id, state.sessionId),
            eq(plotLabSessions.status, "active"),
            eq(plotLabSessions.revision, input.reservedRevision),
            eq(plotLabSessions.pendingSyncActionId, input.actionId)
          )
        )
        .run();
      if (update.changes !== 1) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab reservation was lost.");
      }
      tx.update(plotLabActions)
        .set({
          status: "failed",
          responseJson: JSON.stringify({ error: input.publicError }),
          completedAt: now,
        })
        .where(and(eq(plotLabActions.id, action.id), eq(plotLabActions.status, "reserved")))
        .run();
      return failed;
    });
  }

  async queueGeneration(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    envelope: PlotLabActionEnvelope & {
      action: { kind: "request_generation" } | { kind: "retry_failed_stage"; jobId: string };
    };
    requestHash: string;
    jobId: string;
    modelId: string;
    thinking: boolean;
    inputSnapshot: Record<string, unknown>;
  }): Promise<{ session: PlotLabSessionState; jobId: string }> {
    return this.database.transaction((tx) => {
      requireDocumentAccess(tx, input.documentId, input.userId, input.isAdmin);
      if (
        tx.select().from(plotLabActions).where(eq(plotLabActions.actionId, input.envelope.actionId)).get()
      ) {
        throw new PlotLabRepositoryError("ACTION_ALREADY_EXISTS", "This Plot Lab action ID has already been used.");
      }
      const row = activeSessionRow(tx, input.documentId);
      if (!row) throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "No active Plot Lab session exists.");
      const state = toSession(row);
      assertPlotLabRevision(state, input.envelope.expectedRevision);
      assertPlotLabActionAllowed(state, input.envelope.action);
      if (!state.interviewCheckpoint.readyForCreative) {
        throw new PlotLabRepositoryError("SESSION_STALE", "Levi still needs an interview answer.");
      }
      const queued = transitionPlotLabSession(state, { type: "generation_queued", jobId: input.jobId });
      const now = new Date();
      const response = { kind: "generation_queued", jobId: input.jobId, revision: queued.revision };

      tx.insert(aiJobs).values({
        id: input.jobId,
        documentId: input.documentId,
        tabId: null,
        promptKind: "plot_lab_generate",
        status: "pending",
        modelId: input.modelId,
        thinking: input.thinking,
        contextSnapshot: JSON.stringify({ orientation: state.orientation }),
        createdBy: input.userId,
        createdAt: now,
        plotLabSessionId: state.sessionId,
        concurrencyKey: "plot_lab:" + state.sessionId,
        sessionRevision: queued.revision,
        inputSnapshotJson: JSON.stringify(input.inputSnapshot),
        currentStage: "creative",
        stageAttemptsJson: JSON.stringify({ creative: 0, connecting: 0 }),
      }).run();
      tx.insert(plotLabActions).values({
        id: input.envelope.actionId,
        actionId: input.envelope.actionId,
        documentId: input.documentId,
        sessionId: state.sessionId,
        createdBy: input.userId,
        requestHash: input.requestHash,
        actionKind: input.envelope.action.kind,
        baseRevision: input.envelope.expectedRevision,
        status: "queued",
        requestJson: JSON.stringify(input.envelope),
        responseJson: JSON.stringify(response),
        jobId: input.jobId,
        createdAt: now,
      }).run();
      const updated = tx.update(plotLabSessions)
        .set(mutableSessionValues(queued, now))
        .where(and(
          eq(plotLabSessions.id, state.sessionId),
          eq(plotLabSessions.status, "active"),
          eq(plotLabSessions.revision, input.envelope.expectedRevision)
        )).run();
      if (updated.changes !== 1) throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab session changed.");
      return { session: queued, jobId: input.jobId };
    });
  }

  async startGenerationStage(input: {
    jobId: string;
    stage: PlotLabGenerationStage;
  }): Promise<PlotLabSessionState> {
    return this.database.transaction((tx) => {
      const job = tx.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).get();
      if (!job?.plotLabSessionId || !["pending", "running"].includes(job.status)) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab generation job is no longer active.");
      }
      const row = tx.select().from(plotLabSessions).where(eq(plotLabSessions.id, job.plotLabSessionId)).get();
      if (!row) throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The Plot Lab session no longer exists.");
      const state = toSession(row);
      const next = transitionPlotLabSession(state, {
        type: "job_stage_started",
        jobId: input.jobId,
        stage: input.stage,
      });
      const now = new Date();
      tx.update(plotLabSessions).set(mutableSessionValues(next, now))
        .where(and(eq(plotLabSessions.id, state.sessionId), eq(plotLabSessions.revision, state.revision))).run();
      tx.update(aiJobs).set({
        status: "running",
        currentStage: input.stage,
        startedAt: job.startedAt ?? now,
      }).where(eq(aiJobs.id, input.jobId)).run();
      return next;
    });
  }

  async saveGenerationCheckpoint(input: {
    jobId: string;
    checkpoint: Record<string, unknown>;
  }): Promise<void> {
    const updated = this.database.update(aiJobs).set({
      stageCheckpointJson: JSON.stringify(input.checkpoint),
    }).where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.status, "running"))).run();
    if (updated.changes !== 1) {
      throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab generation job lost its reservation.");
    }
  }

  async completeGeneration(input: {
    jobId: string;
    batch: PlotLabConnectedBatch;
  }): Promise<PlotLabSessionState> {
    return this.database.transaction((tx) => {
      const job = tx.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).get();
      if (!job?.plotLabSessionId || job.status !== "running") {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab generation job is no longer running.");
      }
      const row = tx.select().from(plotLabSessions).where(eq(plotLabSessions.id, job.plotLabSessionId)).get();
      if (!row) throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The Plot Lab session no longer exists.");
      const state = toSession(row);
      const version = (state.latestOutputVersion ?? 0) + 1;
      if (input.batch.version !== version) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The generated output version is stale.");
      }
      const now = new Date();
      tx.update(plotLabOutputs).set({ status: "superseded", supersededAt: now })
        .where(and(eq(plotLabOutputs.sessionId, state.sessionId), eq(plotLabOutputs.status, "current"))).run();
      tx.insert(plotLabOutputs).values({
        id: input.jobId + ":output:" + version,
        sessionId: state.sessionId,
        version,
        parentVersion: state.latestOutputVersion ?? null,
        jobId: input.jobId,
        status: "current",
        mutationKind: "initial_generation",
        batchJson: JSON.stringify(input.batch),
        createdAt: now,
      }).run();
      const completed = transitionPlotLabSession(state, {
        type: "job_completed",
        jobId: input.jobId,
        outputVersion: version,
      });
      const label = state.orientation === "portrait" ? "episode" : "milestone";
      insertMessages(tx, state.sessionId, [{
        id: input.jobId + ":final-batch",
        sessionId: state.sessionId,
        role: "levi",
        kind: "final_batch",
        content: "Here is the first connected " + label + " batch.",
        payload: { batch: input.batch },
        actionId: job.id,
        dependencyIds: [],
        replayScope: "derived",
      }], now);
      tx.update(plotLabSessions).set(mutableSessionValues(completed, now))
        .where(and(eq(plotLabSessions.id, state.sessionId), eq(plotLabSessions.revision, state.revision))).run();
      tx.update(aiJobs).set({
        status: "completed",
        currentStage: "connecting",
        resultJson: JSON.stringify({ batch: input.batch }),
        completedAt: now,
      }).where(eq(aiJobs.id, input.jobId)).run();
      tx.update(plotLabActions).set({
        status: "completed",
        responseJson: JSON.stringify({ kind: "generation_completed", jobId: input.jobId, outputVersion: version }),
        completedAt: now,
      }).where(eq(plotLabActions.jobId, input.jobId)).run();
      return completed;
    });
  }

  async failGeneration(input: {
    jobId: string;
    stage: PlotLabGenerationStage;
    publicError: string;
  }): Promise<PlotLabSessionState> {
    return this.database.transaction((tx) => {
      const job = tx.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).get();
      if (!job?.plotLabSessionId) throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The Plot Lab job is missing.");
      const row = tx.select().from(plotLabSessions).where(eq(plotLabSessions.id, job.plotLabSessionId)).get();
      if (!row) throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The Plot Lab session is missing.");
      const state = toSession(row);
      const failed = transitionPlotLabSession(state, {
        type: "job_stage_failed",
        jobId: input.jobId,
        stage: input.stage,
      });
      const now = new Date();
      insertMessages(tx, state.sessionId, [{
        id: input.jobId + ":generation-error",
        sessionId: state.sessionId,
        role: "system",
        kind: "generation_error",
        content: input.publicError,
        actionId: job.id,
        dependencyIds: [],
        replayScope: "derived",
      }], now);
      tx.update(plotLabSessions).set(mutableSessionValues(failed, now))
        .where(and(eq(plotLabSessions.id, state.sessionId), eq(plotLabSessions.revision, state.revision))).run();
      tx.update(aiJobs).set({
        status: "failed",
        currentStage: input.stage,
        failureReason: input.publicError,
        completedAt: now,
      }).where(eq(aiJobs.id, input.jobId)).run();
      tx.update(plotLabActions).set({
        status: "failed",
        responseJson: JSON.stringify({ error: input.publicError }),
        completedAt: now,
      }).where(eq(plotLabActions.jobId, input.jobId)).run();
      return failed;
    });
  }

  async restartSession(input: {
    documentId: string;
    userId: string;
    isAdmin?: boolean;
    envelope: PlotLabActionEnvelope & { action: { kind: "restart" } };
    requestHash: string;
    replacementSessionId: string;
    orientation: PlotLabSessionState["orientation"];
    archivedAt: string;
  }): Promise<{ archivedSessionId: string; session: PlotLabSessionState }> {
    return this.database.transaction((tx) => {
      requireDocumentAccess(tx, input.documentId, input.userId, input.isAdmin);
      const existing = tx
        .select()
        .from(plotLabActions)
        .where(eq(plotLabActions.actionId, input.envelope.actionId))
        .get();
      const replay = replayResult(
        existing,
        { documentId: input.documentId, userId: input.userId },
        input.requestHash
      );
      if (replay.kind === "replay") {
        const sessionId = String(replay.action.response?.replacementSessionId ?? "");
        const replacement = tx
          .select()
          .from(plotLabSessions)
          .where(eq(plotLabSessions.id, sessionId))
          .get();
        if (!replacement) {
          throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "The replacement session is missing.");
        }
        return { archivedSessionId: replay.action.sessionId, session: toSession(replacement) };
      }
      if (replay.kind === "scope_mismatch") {
        throw new PlotLabRepositoryError("ACTION_SCOPE_MISMATCH", "The action ID belongs to another scope.");
      }
      if (replay.kind === "request_mismatch") {
        throw new PlotLabRepositoryError(
          "ACTION_REQUEST_MISMATCH",
          "The action ID was reused with different content."
        );
      }

      const row = activeSessionRow(tx, input.documentId);
      if (!row) {
        throw new PlotLabRepositoryError("SESSION_NOT_FOUND", "No active Plot Lab session exists.");
      }
      const current = toSession(row);
      assertPlotLabRevision(current, input.envelope.expectedRevision);
      const archived = transitionPlotLabSession(current, {
        type: "session_archived",
        archivedAt: input.archivedAt,
      });
      const now = new Date();
      const archiveUpdate = tx
        .update(plotLabSessions)
        .set(mutableSessionValues(archived, now))
        .where(
          and(
            eq(plotLabSessions.id, current.sessionId),
            eq(plotLabSessions.status, "active"),
            eq(plotLabSessions.revision, input.envelope.expectedRevision)
          )
        )
        .run();
      if (archiveUpdate.changes !== 1) {
        throw new PlotLabRepositoryError("SESSION_STALE", "The Plot Lab session changed.");
      }
      if (current.activeJobId) {
        tx.update(aiJobs)
          .set({ status: "cancelled", completedAt: now, failureReason: "session_restarted" })
          .where(
            and(
              eq(aiJobs.id, current.activeJobId),
              inArray(aiJobs.status, ["pending", "running"])
            )
          )
          .run();
      }
      if (current.pendingSyncActionId) {
        tx.update(plotLabActions)
          .set({
            status: "failed",
            responseJson: JSON.stringify({ error: "session_restarted" }),
            completedAt: now,
          })
          .where(
            and(
              eq(plotLabActions.actionId, current.pendingSyncActionId),
              eq(plotLabActions.status, "reserved")
            )
          )
          .run();
      }

      const replacement = createPlotLabIntakeSession({
        sessionId: input.replacementSessionId,
        documentId: input.documentId,
        createdBy: input.userId,
        orientation: input.orientation,
      });
      tx.insert(plotLabSessions).values(sessionInsertValues(replacement, now)).run();
      tx.insert(plotLabActions)
        .values({
          id: input.envelope.actionId,
          actionId: input.envelope.actionId,
          documentId: input.documentId,
          sessionId: current.sessionId,
          createdBy: input.userId,
          requestHash: input.requestHash,
          actionKind: "restart",
          baseRevision: input.envelope.expectedRevision,
          status: "completed",
          requestJson: JSON.stringify(input.envelope),
          responseJson: JSON.stringify({ replacementSessionId: replacement.sessionId }),
          createdAt: now,
          completedAt: now,
        })
        .run();
      return { archivedSessionId: current.sessionId, session: replacement };
    });
  }
}
