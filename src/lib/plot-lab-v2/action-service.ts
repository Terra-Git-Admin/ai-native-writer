import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import type {
  PlotLabAction,
  PlotLabActionEnvelope,
  PlotLabConnectedBatch,
  PlotLabInterviewCheckpoint,
  PlotLabMessage,
  PlotLabMutationProposal,
  PlotLabReferenceInput,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";
import {
  hashPlotLabActionRequest,
  isPlotLabActionId,
} from "@/lib/plot-lab-v2/action-idempotency";
import { createMockPlotLabTurn } from "@/lib/plot-lab-v2/mock-turn";
import type { PlotLabRepository } from "@/lib/plot-lab-v2/repository-contract";
import { capturePlotLabStartSnapshot } from "@/lib/plot-lab-v2/source-snapshot";
import { startPlotLabGenerationJob } from "@/lib/plot-lab-v2/generation-runner";
import {
  generateRealInterviewTurn,
  generateRealConversationTurn,
  isPlotLabRealAIEnabled,
  PLOT_LAB_PROMPT_VERSIONS,
  resolvePlotLabModel,
  type PlotLabModelChoice,
} from "@/lib/plot-lab-v2/real-ai";

type Database = BetterSQLite3Database<typeof schema>;

export class PlotLabActionServiceError extends Error {
  readonly code:
    | "INVALID_ACTION"
    | "ACTION_ID_REUSED"
    | "ACTION_IN_PROGRESS"
    | "ACTION_FAILED"
    | "ANSWER_NOT_FOUND"
    | "AI_UNAVAILABLE"
    | "AI_RESPONSE_FAILED";
  readonly status: number;

  constructor(code: PlotLabActionServiceError["code"], message: string, status = 400) {
    super(message);
    this.name = "PlotLabActionServiceError";
    this.code = code;
    this.status = status;
  }
}

function nonEmptyString(value: unknown, max = 20_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseReferences(value: unknown): PlotLabReferenceInput[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const parsed: PlotLabReferenceInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (record.type === "text" && nonEmptyString(record.text)) {
      parsed.push({ type: "text", text: record.text });
    } else if (record.type === "url" && nonEmptyString(record.url, 2_000)) {
      parsed.push({ type: "url", url: record.url });
    } else {
      return null;
    }
  }
  return parsed;
}

export function parsePlotLabActionEnvelope(value: unknown): PlotLabActionEnvelope {
  if (!value || typeof value !== "object") {
    throw new PlotLabActionServiceError("INVALID_ACTION", "A Plot Lab action envelope is required.");
  }
  const envelope = value as Record<string, unknown>;
  if (!isPlotLabActionId(String(envelope.actionId ?? ""))) {
    throw new PlotLabActionServiceError("INVALID_ACTION", "actionId must be a UUID.");
  }
  if (!Number.isInteger(envelope.expectedRevision) || Number(envelope.expectedRevision) < 0) {
    throw new PlotLabActionServiceError(
      "INVALID_ACTION",
      "expectedRevision must be a non-negative integer."
    );
  }
  if (!envelope.action || typeof envelope.action !== "object") {
    throw new PlotLabActionServiceError("INVALID_ACTION", "action is required.");
  }
  const raw = envelope.action as Record<string, unknown>;
  let action: PlotLabAction;
  switch (raw.kind) {
    case "start": {
      const references = parseReferences(raw.references);
      if (!nonEmptyString(raw.seed) || !references) {
        throw new PlotLabActionServiceError(
          "INVALID_ACTION",
          "Start requires a seed and a valid references array."
        );
      }
      action = { kind: "start", seed: raw.seed, references };
      break;
    }
    case "answer":
      if (!nonEmptyString(raw.questionMessageId, 200) || !nonEmptyString(raw.text)) {
        throw new PlotLabActionServiceError("INVALID_ACTION", "Answer requires a question and text.");
      }
      action = {
        kind: "answer",
        questionMessageId: raw.questionMessageId,
        text: raw.text,
        ...(typeof raw.selectedStarterId === "string"
          ? { selectedStarterId: raw.selectedStarterId }
          : {}),
      };
      break;
    case "edit_answer":
      if (!nonEmptyString(raw.answerMessageId, 200) || !nonEmptyString(raw.text)) {
        throw new PlotLabActionServiceError(
          "INVALID_ACTION",
          "Edit answer requires an answer message and replacement text."
        );
      }
      action = { kind: "edit_answer", answerMessageId: raw.answerMessageId, text: raw.text };
      break;
    case "add_context":
      if (!nonEmptyString(raw.text)) {
        throw new PlotLabActionServiceError("INVALID_ACTION", "Context text is required.");
      }
      action = { kind: "add_context", text: raw.text };
      break;
    case "request_generation":
      action = { kind: "request_generation" };
      break;
    case "accept_output":
      if (!Number.isInteger(raw.outputVersion) || Number(raw.outputVersion) < 1) {
        throw new PlotLabActionServiceError("INVALID_ACTION", "Accept requires a valid output version.");
      }
      action = { kind: "accept_output", outputVersion: Number(raw.outputVersion) };
      break;
    case "chat":
      if (!nonEmptyString(raw.text, 4_000)) {
        throw new PlotLabActionServiceError("INVALID_ACTION", "Follow-up chat text is required.");
      }
      action = { kind: "chat", text: raw.text };
      break;
    case "confirm_proposal":
      if (!nonEmptyString(raw.proposalId, 200) || (raw.downstreamChoice !== "update" && raw.downstreamChoice !== "keep")) {
        throw new PlotLabActionServiceError("INVALID_ACTION", "Confirm proposal requires a proposal and update or keep choice.");
      }
      action = { kind: "confirm_proposal", proposalId: raw.proposalId, downstreamChoice: raw.downstreamChoice };
      break;
    case "retry_failed_stage":
      if (!nonEmptyString(raw.jobId, 200)) {
        throw new PlotLabActionServiceError("INVALID_ACTION", "Retry requires the failed job ID.");
      }
      action = { kind: "retry_failed_stage", jobId: raw.jobId };
      break;
    case "restart":
      action = { kind: "restart" };
      break;
    default:
      throw new PlotLabActionServiceError(
        "INVALID_ACTION",
        "This action is not available in the mocked interview phase."
      );
  }
  return {
    actionId: String(envelope.actionId),
    expectedRevision: Number(envelope.expectedRevision),
    action,
  };
}

function writerMessage(input: {
  sessionId: string;
  envelope: PlotLabActionEnvelope;
  parentMessageId?: string;
  payload?: Record<string, unknown>;
}): Omit<PlotLabMessage, "sequence" | "createdAt"> | undefined {
  const { action } = input.envelope;
  const content =
    action.kind === "start"
      ? action.seed
      : action.kind === "answer" || action.kind === "edit_answer" || action.kind === "add_context" || action.kind === "chat"
        ? action.text
        : undefined;
  if (!content) return undefined;
  return {
    id: `${input.envelope.actionId}:writer`,
    sessionId: input.sessionId,
    role: "writer",
    kind: action.kind,
    content: content.trim(),
    payload: input.payload,
    actionId: input.envelope.actionId,
    parentMessageId: input.parentMessageId,
    dependencyIds: input.parentMessageId ? [input.parentMessageId] : [],
    replayScope: action.kind === "add_context" || action.kind === "chat" ? "session" : "derived",
  };
}

function sessionModelChoice(
  session: PlotLabSessionState,
  role: "interviewer" | "creative" | "connector"
): PlotLabModelChoice | null {
  const assignment = session.modelAssignments[role];
  return assignment?.modelId
    ? { modelId: assignment.modelId, thinking: assignment.thinking }
    : null;
}

async function createRealInterviewMessages(input: {
  repository: PlotLabRepository;
  documentId: string;
  userId: string;
  isAdmin: boolean;
  session: PlotLabSessionState;
  actionId: string;
  action: PlotLabAction;
  writerMessageId?: string;
  editedQuestionNumber?: number;
  model: PlotLabModelChoice;
}): Promise<{
  leviMessages: Array<Omit<PlotLabMessage, "sequence" | "createdAt">>;
  checkpoint: PlotLabInterviewCheckpoint;
  response: Record<string, unknown>;
  proposal?: PlotLabMutationProposal;
}> {
  const thread = await input.repository.getSessionThread({
    documentId: input.documentId,
    userId: input.userId,
    isAdmin: input.isAdmin,
    includeSuperseded: true,
    limit: 100,
  });
  const previousCount = input.session.interviewCheckpoint.creativeQuestionCount;
  const answeredNumber =
    input.action.kind === "edit_answer"
      ? input.editedQuestionNumber ?? 1
      : previousCount;
  const mustBeReady =
    (input.action.kind === "answer" || input.action.kind === "edit_answer") &&
    answeredNumber >= 4;
  const dependencyIds = input.writerMessageId ? [input.writerMessageId] : [];
  if (mustBeReady) {
    const readyMessage = {
      id: input.actionId + ":ready",
      sessionId: input.session.sessionId,
      role: "levi" as const,
      kind: "interview_ready",
      content: "I have enough to build the first connected batch.",
      actionId: input.actionId,
      dependencyIds,
      replayScope: "derived" as const,
    };
    return {
      leviMessages: [readyMessage],
      checkpoint: {
        creativeQuestionCount: 4,
        readyForCreative: true,
        characterBrief: input.session.interviewCheckpoint.characterBrief,
      },
      response: { kind: "ready" },
    };
  }

  const turn = await generateRealInterviewTurn({
    session: input.session,
    messages: thread.messages,
    model: input.model,
    forceQuestion: input.action.kind === "request_generation",
  });
  if (turn.ready) {
    const readyMessage = {
      id: input.actionId + ":ready",
      sessionId: input.session.sessionId,
      role: "levi" as const,
      kind: "interview_ready",
      content: turn.message,
      actionId: input.actionId,
      dependencyIds,
      replayScope: "derived" as const,
    };
    return {
      leviMessages: [readyMessage],
      checkpoint: {
        creativeQuestionCount: previousCount,
        readyForCreative: true,
        characterBrief: turn.storyBrief,
      },
      response: { kind: "ready" },
    };
  }

  const questionNumber =
    input.action.kind === "request_generation"
      ? Math.max(previousCount, 1)
      : input.action.kind === "start"
        ? 1
        : Math.min((input.action.kind === "edit_answer" ? answeredNumber : previousCount) + 1, 4);
  const questionId = input.actionId + ":question:" + questionNumber;
  const questionMessage = {
    id: questionId,
    sessionId: input.session.sessionId,
    role: "levi" as const,
    kind: "interview_question",
    content: [turn.message, turn.question].filter(Boolean).join("\n\n"),
    payload: {
      questionNumber,
      questionKind: turn.questionKind,
      starters: turn.starters.map((text, index) => ({
        id: input.actionId + ":starter:" + questionNumber + ":" + (index + 1),
        text,
      })),
    },
    actionId: input.actionId,
    dependencyIds,
    replayScope: "derived" as const,
  };
  return {
    leviMessages: [questionMessage],
    checkpoint: {
      creativeQuestionCount: questionNumber,
      readyForCreative: false,
      latestQuestionMessageId: questionId,
      characterBrief: turn.storyBrief,
    },
    response: {
      kind: input.action.kind === "request_generation" ? "blocking_question" : "question",
      questionMessageId: questionId,
    },
  };
}

function latestBatch(messages: PlotLabMessage[]): PlotLabConnectedBatch | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const payload = messages[index]?.payload?.batch;
    if (!payload || typeof payload !== "object") continue;
    const batch = payload as PlotLabConnectedBatch;
    if (Array.isArray(batch.units) && (batch.format === "portrait" || batch.format === "landscape")) {
      return batch;
    }
  }
  return null;
}

async function createRealConversationMessages(input: {
  repository: PlotLabRepository;
  documentId: string;
  userId: string;
  isAdmin: boolean;
  session: PlotLabSessionState;
  actionId: string;
  writerMessageId?: string;
  model: PlotLabModelChoice;
}): Promise<{
  leviMessages: Array<Omit<PlotLabMessage, "sequence" | "createdAt">>;
  checkpoint: PlotLabInterviewCheckpoint;
  response: Record<string, unknown>;
  proposal?: PlotLabMutationProposal;
}> {
  const thread = await input.repository.getSessionThread({
    documentId: input.documentId,
    userId: input.userId,
    isAdmin: input.isAdmin,
    includeSuperseded: false,
    limit: 100,
  });
  const batch = latestBatch(thread.messages);
  if (!batch || !input.session.latestOutputVersion) {
    throw new Error("The current Plot Lab batch is unavailable for follow-up chat.");
  }
  const turn = await generateRealConversationTurn({
    session: input.session,
    messages: thread.messages,
    currentBatch: batch,
    model: input.model,
  });
  const messageId = `${input.actionId}:conversation`;
  const proposalId = turn.kind === "mutation_proposal" ? `${input.actionId}:proposal` : undefined;
  const message = {
    id: messageId,
    sessionId: input.session.sessionId,
    role: "levi" as const,
    kind: turn.kind === "mutation_proposal" ? "mutation_proposal" : "discussion",
    content: turn.message,
    payload: turn.kind === "mutation_proposal"
      ? {
          proposalId,
          instruction: turn.instruction,
          targetUnitNumbers: turn.targetUnitNumbers,
          downstreamUnitNumbers: turn.downstreamUnitNumbers,
          explanation: turn.explanation,
          applied: false,
        }
      : undefined,
    actionId: input.actionId,
    dependencyIds: input.writerMessageId ? [input.writerMessageId] : [],
    replayScope: "session" as const,
  };
  const proposal = proposalId
    ? {
        id: proposalId,
        sessionId: input.session.sessionId,
        sourceMessageId: messageId,
        baseOutputVersion: input.session.latestOutputVersion,
        instruction: turn.instruction,
        targetUnitNumbers: turn.targetUnitNumbers,
        downstreamUnitNumbers: turn.downstreamUnitNumbers,
        explanation: turn.explanation,
        repairScope: turn.repairScope,
        status: "pending" as const,
      }
    : undefined;
  return {
    leviMessages: [message],
    checkpoint: input.session.interviewCheckpoint,
    response: {
      kind: turn.kind,
      ...(proposalId ? { proposalId } : {}),
    },
    proposal,
  };
}

export async function executeMockPlotLabAction(input: {
  database: Database;
  repository: PlotLabRepository;
  documentId: string;
  userId: string;
  isAdmin: boolean;
  envelope: PlotLabActionEnvelope;
}): Promise<Record<string, unknown>> {
  const { repository, documentId, userId, isAdmin, envelope } = input;
  const requestHash = hashPlotLabActionRequest({ documentId, userId }, envelope);
  const replay = await repository.findActionReplay(
    envelope.actionId,
    { documentId, userId },
    requestHash
  );
  if (replay.kind === "scope_mismatch" || replay.kind === "request_mismatch") {
    throw new PlotLabActionServiceError(
      "ACTION_ID_REUSED",
      "This action ID has already been used for a different request.",
      409
    );
  }
  if (replay.kind === "replay") {
    if (replay.action.status === "reserved") {
      throw new PlotLabActionServiceError(
        "ACTION_IN_PROGRESS",
        "This Plot Lab action is still in progress.",
        409
      );
    }
    if (replay.action.status === "failed") {
      throw new PlotLabActionServiceError(
        "ACTION_FAILED",
        String(replay.action.response?.error ?? "The prior action failed."),
        409
      );
    }
    if (replay.action.actionKind === "restart") {
      const replacementSessionId = String(replay.action.response?.replacementSessionId ?? "");
      const replacement = await repository.getSessionThread({
        documentId,
        userId,
        isAdmin,
        sessionId: replacementSessionId,
      });
      return {
        replayed: true,
        ...replay.action.response,
        archivedSessionId: replay.action.sessionId,
        ...replacement,
      };
    }
    const originalThread = await repository.getSessionThread({
      documentId,
      userId,
      isAdmin,
      sessionId: replay.action.sessionId,
    });
    const canonicalSession = await repository.getActiveSession(documentId, userId, isAdmin);
    return {
      replayed: true,
      ...replay.action.response,
      ...originalThread,
      ...(canonicalSession && canonicalSession.sessionId !== originalThread.session.sessionId
        ? { canonicalSession }
        : {}),
    };
  }

  if (envelope.action.kind === "restart") {
    const snapshot = await capturePlotLabStartSnapshot(input.database, documentId, []);
    const result = await repository.restartSession({
      documentId,
      userId,
      isAdmin,
      envelope: envelope as PlotLabActionEnvelope & { action: { kind: "restart" } },
      requestHash,
      replacementSessionId: randomUUID(),
      orientation: snapshot.orientation,
      archivedAt: new Date().toISOString(),
    });
    return { replayed: false, ...result, messages: [] };
  }

  const realAI = isPlotLabRealAIEnabled();
  let resolvedModel: PlotLabModelChoice | null = null;
  if (realAI && envelope.action.kind === "start") {
    try {
      resolvedModel = await resolvePlotLabModel();
    } catch (error) {
      throw new PlotLabActionServiceError(
        "AI_UNAVAILABLE",
        error instanceof Error ? error.message : "No AI provider is configured.",
        503
      );
    }
  }

  let session = await repository.getActiveSession(documentId, userId, isAdmin);
  let startSnapshot:
    | Awaited<ReturnType<typeof capturePlotLabStartSnapshot>>
    | undefined;
  if (envelope.action.kind === "start") {
    startSnapshot = await capturePlotLabStartSnapshot(
      input.database,
      documentId,
      envelope.action.references
    );
    if (!session) {
      session = await repository.createIntakeSession({
        documentId,
        userId,
        isAdmin,
        sessionId: randomUUID(),
        orientation: startSnapshot.orientation,
      });
    }
  }
  if (!session) {
    throw new PlotLabActionServiceError(
      "INVALID_ACTION",
      "Start Plot Lab before sending interview actions."
    );
  }
  if (envelope.action.kind === "accept_output") {
    if (session.latestOutputVersion !== envelope.action.outputVersion) {
      throw new PlotLabActionServiceError("INVALID_ACTION", "Only the current Plot Lab output can be accepted.", 409);
    }
    const reserved = await repository.reserveSynchronousAction({
      documentId,
      userId,
      isAdmin,
      requestHash,
      envelope,
    });
    await repository.finalizeSynchronousAction({
      actionId: envelope.actionId,
      reservedRevision: reserved.session.revision,
      leviMessages: [{
        id: `${envelope.actionId}:accepted`,
        sessionId: session.sessionId,
        role: "levi",
        kind: "output_accepted",
        content: `Accepted output version ${envelope.action.outputVersion} as the current quality baseline.`,
        actionId: envelope.actionId,
        dependencyIds: [],
        replayScope: "session",
      }],
      sessionPatch: { latestAcceptedOutputVersion: envelope.action.outputVersion },
      response: { kind: "output_accepted", outputVersion: envelope.action.outputVersion },
    });
    const canonical = await repository.getSessionThread({ documentId, userId, isAdmin });
    return { replayed: false, kind: "output_accepted", outputVersion: envelope.action.outputVersion, ...canonical };
  }
  if (envelope.action.kind === "confirm_proposal" && envelope.action.downstreamChoice === "keep") {
    const reserved = await repository.reserveSynchronousAction({ documentId, userId, isAdmin, requestHash, envelope });
    await repository.finalizeSynchronousAction({
      actionId: envelope.actionId,
      reservedRevision: reserved.session.revision,
      leviMessages: [{
        id: `${envelope.actionId}:proposal-kept`, sessionId: session.sessionId, role: "levi", kind: "proposal_resolved",
        content: "Kept the current batch. No generation was triggered.", actionId: envelope.actionId, dependencyIds: [], replayScope: "session",
      }],
      sessionPatch: {},
      response: { kind: "proposal_rejected", proposalId: envelope.action.proposalId },
    });
    const canonical = await repository.getSessionThread({ documentId, userId, isAdmin });
    return { replayed: false, kind: "proposal_rejected", ...canonical };
  }
  if (realAI && !resolvedModel) {
    resolvedModel =
      sessionModelChoice(
        session,
        envelope.action.kind === "request_generation" || envelope.action.kind === "retry_failed_stage"
          ? "creative"
          : "interviewer"
      );
    if (!resolvedModel) {
      try {
        resolvedModel = await resolvePlotLabModel();
      } catch (error) {
        throw new PlotLabActionServiceError(
          "AI_UNAVAILABLE",
          error instanceof Error ? error.message : "No AI provider is configured.",
          503
        );
      }
    }
  }

  if (realAI && envelope.action.kind === "confirm_proposal" && envelope.action.downstreamChoice === "update") {
    const proposal = await input.database.query.plotLabProposals.findFirst({ where: eq(schema.plotLabProposals.id, envelope.action.proposalId) });
    if (!proposal || proposal.sessionId !== session.sessionId || proposal.status !== "pending" || proposal.baseOutputVersion !== session.latestOutputVersion) {
      throw new PlotLabActionServiceError("INVALID_ACTION", "That change proposal is stale or unavailable.", 409);
    }
    const output = await input.database.query.plotLabOutputs.findFirst({
      where: and(eq(schema.plotLabOutputs.sessionId, session.sessionId), eq(schema.plotLabOutputs.version, proposal.baseOutputVersion)),
    });
    const baseJob = output?.jobId
      ? await input.database.query.aiJobs.findFirst({ where: eq(schema.aiJobs.id, output.jobId) })
      : null;
    let artifacts: Record<string, unknown> = {};
    try {
      const checkpoint = baseJob?.stageCheckpointJson ? JSON.parse(baseJob.stageCheckpointJson) as { artifacts?: Record<string, unknown> } : {};
      artifacts = checkpoint.artifacts ?? {};
    } catch {
      throw new PlotLabActionServiceError("INVALID_ACTION", "The accepted planning artifacts could not be read.", 409);
    }
    const resumeStage = proposal.repairScope === "connector"
      ? "connecting"
      : proposal.repairScope === "unit"
        ? "creative_authoring"
        : proposal.repairScope === "destination"
          ? "endpoint_exploration"
          : "route_exploration";
    const thread = await repository.getSessionThread({ documentId, userId, isAdmin, includeSuperseded: false, limit: 100 });
    const jobId = randomUUID();
    const queued = await repository.queueGeneration({
      documentId, userId, isAdmin,
      envelope: envelope as PlotLabActionEnvelope & { action: { kind: "confirm_proposal"; proposalId: string; downstreamChoice?: "update" | "keep" } },
      requestHash, jobId, modelId: resolvedModel!.modelId, thinking: resolvedModel!.thinking,
      inputSnapshot: {
        session, messages: thread.messages, model: resolvedModel, promptVersions: PLOT_LAB_PROMPT_VERSIONS,
        resumeStage, artifacts, mutationKind: `confirmed_${proposal.repairScope}_change`, proposalId: proposal.id,
        confirmedInstruction: proposal.instruction,
      },
    });
    startPlotLabGenerationJob(jobId);
    const canonical = await repository.getSessionThread({ documentId, userId, isAdmin });
    return { replayed: false, kind: "generation_queued", jobId, revision: queued.session.revision, ...canonical };
  }

  if (realAI && envelope.action.kind === "retry_failed_stage") {
    const failedJob = await input.database.query.aiJobs.findFirst({
      where: eq(schema.aiJobs.id, envelope.action.jobId),
    });
    if (
      !failedJob ||
      failedJob.plotLabSessionId !== session.sessionId ||
      failedJob.status !== "failed" ||
      session.activeJobId !== failedJob.id ||
      !session.failedStage ||
      !failedJob.inputSnapshotJson
    ) {
      throw new PlotLabActionServiceError(
        "INVALID_ACTION",
        "That failed generation is no longer available to retry.",
        409
      );
    }

    let previousInput: Record<string, unknown>;
    let checkpoint: Record<string, unknown> = {};
    try {
      previousInput = JSON.parse(failedJob.inputSnapshotJson) as Record<string, unknown>;
      if (failedJob.stageCheckpointJson) {
        checkpoint = JSON.parse(failedJob.stageCheckpointJson) as Record<string, unknown>;
      }
    } catch {
      throw new PlotLabActionServiceError(
        "INVALID_ACTION",
        "The saved generation checkpoint could not be read.",
        409
      );
    }

    const artifacts = checkpoint.artifacts;
    if (session.failedStage !== "source_truth" && (!artifacts || typeof artifacts !== "object")) {
      throw new PlotLabActionServiceError(
        "INVALID_ACTION",
        "The saved orchestration checkpoint is unavailable. Restart with Levi to try again.",
        409
      );
    }

    const jobId = randomUUID();
    const queued = await repository.queueGeneration({
      documentId,
      userId,
      isAdmin,
      envelope: envelope as PlotLabActionEnvelope & {
        action: { kind: "retry_failed_stage"; jobId: string };
      },
      requestHash,
      jobId,
      modelId: failedJob.modelId,
      thinking: failedJob.thinking,
      inputSnapshot: {
        ...previousInput,
        session,
        model: { modelId: failedJob.modelId, thinking: failedJob.thinking },
        resumeStage: session.failedStage,
        ...(artifacts && typeof artifacts === "object" ? { artifacts } : {}),
      },
    });
    startPlotLabGenerationJob(jobId);
    const canonical = await repository.getSessionThread({ documentId, userId, isAdmin });
    return {
      replayed: false,
      kind: "generation_queued",
      jobId,
      revision: queued.session.revision,
      ...canonical,
    };
  }

  if (
    realAI &&
    envelope.action.kind === "request_generation" &&
    session.interviewCheckpoint.readyForCreative
  ) {
    const thread = await repository.getSessionThread({
      documentId,
      userId,
      isAdmin,
      includeSuperseded: false,
      limit: 100,
    });
    const jobId = randomUUID();
    const queued = await repository.queueGeneration({
      documentId,
      userId,
      isAdmin,
      envelope: envelope as PlotLabActionEnvelope & { action: { kind: "request_generation" } },
      requestHash,
      jobId,
      modelId: resolvedModel!.modelId,
      thinking: resolvedModel!.thinking,
      inputSnapshot: {
        session,
        messages: thread.messages,
        model: resolvedModel,
        promptVersions: PLOT_LAB_PROMPT_VERSIONS,
      },
    });
    startPlotLabGenerationJob(jobId);
    const canonical = await repository.getSessionThread({ documentId, userId, isAdmin });
    return {
      replayed: false,
      kind: "generation_queued",
      jobId,
      revision: queued.session.revision,
      ...canonical,
    };
  }

  let parentMessageId: string | undefined;
  let editedQuestionNumber: number | undefined;
  let supersedeFromMessageId: string | undefined;
  if (envelope.action.kind === "answer") {
    const questionMessageId = envelope.action.questionMessageId;
    const thread = await repository.getSessionThread({ documentId, userId, isAdmin, limit: 100 });
    const question = thread.messages.find(
      (message) =>
        message.id === questionMessageId && message.kind === "interview_question"
    );
    if (!question || question.id !== session.interviewCheckpoint.latestQuestionMessageId) {
      throw new PlotLabActionServiceError(
        "ANSWER_NOT_FOUND",
        "That interview question is no longer the active question.",
        409
      );
    }
    parentMessageId = question.id;
  } else if (envelope.action.kind === "edit_answer") {
    const answerMessageId = envelope.action.answerMessageId;
    const thread = await repository.getSessionThread({
      documentId,
      userId,
      isAdmin,
      includeSuperseded: true,
      limit: 100,
    });
    const original = thread.messages.find(
      (message) =>
        message.id === answerMessageId &&
        message.role === "writer" &&
        message.kind === "answer" &&
        !message.supersededAt
    );
    const question = original?.parentMessageId
      ? thread.messages.find((message) => message.id === original.parentMessageId)
      : undefined;
    if (!original || !question) {
      throw new PlotLabActionServiceError(
        "ANSWER_NOT_FOUND",
        "That submitted answer is no longer editable.",
        409
      );
    }
    parentMessageId = question.id;
    editedQuestionNumber = Number(question.payload?.questionNumber ?? 1);
    supersedeFromMessageId = original.id;
  } else if (
    envelope.action.kind === "request_generation" &&
    !session.interviewCheckpoint.readyForCreative
  ) {
    supersedeFromMessageId = session.interviewCheckpoint.latestQuestionMessageId;
  }

  const message = writerMessage({
    sessionId: session.sessionId,
    envelope,
    parentMessageId,
    payload:
      envelope.action.kind === "answer" && envelope.action.selectedStarterId
        ? { selectedStarterId: envelope.action.selectedStarterId }
        : undefined,
  });
  const reserved = await repository.reserveSynchronousAction({
    documentId,
    userId,
    isAdmin,
    requestHash,
    envelope,
    writerMessage: message,
    startSnapshot: startSnapshot
      ? {
          sourceSnapshot: startSnapshot.sourceSnapshot,
          sourceHashes: startSnapshot.sourceHashes,
          referenceSnapshots: startSnapshot.referenceSnapshots,
        }
      : undefined,
  });
  let turn;
  try {
    turn = realAI
      ? envelope.action.kind === "chat"
        ? await createRealConversationMessages({
            repository,
            documentId,
            userId,
            isAdmin,
            session: reserved.session,
            actionId: envelope.actionId,
            writerMessageId: message?.id,
            model: resolvedModel!,
          })
        : await createRealInterviewMessages({
            repository,
            documentId,
            userId,
            isAdmin,
            session: reserved.session,
            actionId: envelope.actionId,
            action: envelope.action,
            writerMessageId: message?.id,
            editedQuestionNumber,
            model: resolvedModel!,
          })
      : createMockPlotLabTurn({
          session: reserved.session,
          actionId: envelope.actionId,
          action: envelope.action,
          writerMessageId: message?.id,
          editedQuestionNumber,
        });
  } catch (error) {
    const publicError =
      error instanceof Error && /configured|API key/i.test(error.message)
        ? error.message
        : "Levi could not complete that interview turn. Please try again.";
    await repository.failSynchronousAction({
      actionId: envelope.actionId,
      reservedRevision: reserved.session.revision,
      publicError,
    });
    throw new PlotLabActionServiceError("AI_RESPONSE_FAILED", publicError, 502);
  }
  const response = {
    ...turn.response,
    revision: reserved.session.revision + 1,
  };
  await repository.finalizeSynchronousAction({
    actionId: envelope.actionId,
    reservedRevision: reserved.session.revision,
    leviMessages: turn.leviMessages,
    sessionPatch: {
      interviewCheckpoint: turn.checkpoint,
      ...(realAI && resolvedModel
        ? {
            promptVersions: PLOT_LAB_PROMPT_VERSIONS,
            modelAssignments: {
              interviewer: resolvedModel,
              creative: resolvedModel,
              connector: resolvedModel,
            },
            trainingPackVersion: "unseeded",
          }
        : {}),
    },
    response,
    supersedeFromMessageId,
    proposal: turn.proposal,
  });
  const thread = await repository.getSessionThread({ documentId, userId, isAdmin });
  return { replayed: false, ...response, ...thread };
}
