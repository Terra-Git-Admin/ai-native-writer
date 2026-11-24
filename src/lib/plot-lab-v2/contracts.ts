import type { DocumentOrientation } from "@/lib/document-orientation";

export type PlotLabSessionStatus = "active" | "archived";

export type PlotLabSessionPhase =
  | "intake"
  | "interview"
  | "purpose_review"
  | "queued"
  | "orchestrating"
  | "creative"
  | "reviewing"
  | "connecting"
  | "complete"
  | "recoverable_error";

export type PlotLabGenerationStage =
  | "purpose_planning"
  | "plot_writing"
  | "source_truth"
  | "endpoint_exploration"
  | "route_exploration"
  | "specialist_planning"
  | "creative_authoring"
  | "holistic_qa"
  | "targeted_repair"
  | "connecting"
  | "creative"
  | "unit_creative"
  | "continuity";

export interface PlotLabSourcePacket {
  episode1Plot?: string;
  episode1Script?: string;
  characters?: string;
  originalResearch?: string;
}

export type PlotLabReferenceInput =
  | { type: "text"; text: string }
  | { type: "url"; url: string };

export interface PlotLabReferenceSnapshot {
  id: string;
  type: "text" | "url";
  label?: string;
  sourceUrl?: string;
  capturedText: string;
  contentHash: string;
  capturedAt: string;
}

export interface PlotLabStorySoul {
  premise: string;
  characterEngine: string;
  centralRelationship: string;
  emotionalPromise: string;
  tone: string;
  unresolvedPressure: string;
}

export interface PlotLabStoryBrief {
  storySoul: PlotLabStorySoul;
  monetizationPoint: string;
  requiredSkeletonElements: string[];
}

export interface PlotLabInterviewCheckpoint {
  creativeQuestionCount: number;
  readyForCreative: boolean;
  latestQuestionMessageId?: string;
  characterBrief?: PlotLabStoryBrief;
}

export interface PlotLabModelAssignment {
  modelId: string;
  thinking: boolean;
}

export interface PlotLabSessionState {
  sessionId: string;
  documentId: string;
  createdBy: string;
  status: PlotLabSessionStatus;
  phase: PlotLabSessionPhase;
  revision: number;
  orientation: DocumentOrientation;
  sourceSnapshot?: PlotLabSourcePacket;
  sourceHashes?: Record<string, string>;
  seed?: string;
  referenceSnapshots: PlotLabReferenceSnapshot[];
  interviewCheckpoint: PlotLabInterviewCheckpoint;
  confirmedRetcons: Array<{ conflictId: string; statement: string }>;
  latestOutputVersion?: number;
  latestAcceptedOutputVersion?: number;
  activeJobId?: string;
  pendingSyncActionId?: string;
  failedStage?: PlotLabGenerationStage;
  promptVersions: Record<string, string>;
  modelAssignments: Record<string, PlotLabModelAssignment>;
  trainingPackVersion: string;
  archivedAt?: string;
}

export type PlotLabAction =
  | { kind: "start"; seed: string; references: PlotLabReferenceInput[] }
  | { kind: "answer"; questionMessageId: string; text: string; selectedStarterId?: string }
  | { kind: "edit_answer"; answerMessageId: string; text: string }
  | { kind: "add_context"; text: string }
  | { kind: "request_generation" }
  | { kind: "revise_purpose_map"; purposeMapMessageId: string; instruction: string }
  | { kind: "approve_purpose_map"; purposeMapMessageId: string }
  | { kind: "accept_output"; outputVersion: number }
  | { kind: "chat"; text: string }
  | { kind: "confirm_proposal"; proposalId: string; downstreamChoice?: "update" | "keep" }
  | { kind: "regenerate_all"; instruction: string }
  | { kind: "regenerate_unit"; unitNumber: number; instruction: string }
  | { kind: "resolve_unit_candidate"; candidateOutputId: string; choice: "update" | "keep" }
  | { kind: "continue_generation_with_snapshot"; originalActionId: string }
  | { kind: "retry_failed_stage"; jobId: string }
  | { kind: "confirm_retcon"; conflictId: string; confirmed: boolean }
  | { kind: "restart" };

export interface PlotLabActionEnvelope {
  actionId: string;
  expectedRevision: number;
  action: PlotLabAction;
}

export type PlotLabMessageRole = "writer" | "levi" | "system";

export interface PlotLabMessage {
  id: string;
  sessionId: string;
  sequence: number;
  role: PlotLabMessageRole;
  kind: string;
  content: string;
  payload?: Record<string, unknown>;
  actionId?: string;
  parentMessageId?: string;
  dependencyIds: string[];
  replayScope: "derived" | "session";
  supersededAt?: string;
  createdAt: string;
}

export interface PlotLabMutationProposal {
  id: string;
  sessionId: string;
  sourceMessageId: string;
  baseOutputVersion: number;
  instruction: string;
  targetUnitNumbers: number[] | "all";
  downstreamUnitNumbers: number[];
  explanation: string;
  repairScope: "connector" | "unit" | "route" | "destination";
  status: "pending" | "confirmed" | "rejected" | "stale";
  confirmedChoice?: "update" | "keep";
}

export interface PlotLabSourceTruthBrief {
  episode1Soul: PlotLabStorySoul;
  canonFacts: string[];
  requiredSkeletonElements: string[];
  monetizationPoint: string;
  characterFidelity: string[];
  unresolvedQuestions: string[];
}

export interface PlotLabEndpointCandidate {
  id: string;
  finalTurn: string;
  visual: string;
  emotionalCost: string;
  causalRequirements: string[];
}

export interface PlotLabRouteCandidate {
  id: string;
  thesis: string;
  endpointCandidateId: string;
  unitSpine: Array<{
    number: number;
    purpose: string;
    cause: string;
    choice: string;
    changedState: string;
    outgoingPressure: string;
  }>;
}

export interface PlotLabOrchestratorDecision {
  selectedRouteId: string;
  rationale: string;
  qualityDefinition: string[];
  specialistNeeds: {
    characterRelationship: { needed: boolean; reason: string };
    oppositionPressure: { needed: boolean; reason: string };
    timeLocationWorld: { needed: boolean; reason: string };
  };
}

export interface PlotLabSpecialistBrief {
  role: "character_relationship" | "opposition_pressure" | "time_location_world";
  guidance: string[];
  risks: string[];
}

export interface PlotLabQAResult {
  verdict: "strong" | "repair_recommended";
  strengths: string[];
  primaryIssue: string;
  repairInstruction: string;
  owner: "creative_author" | "connector";
  affectedUnitNumbers: number[];
}

export interface PlotLabOrchestrationArtifacts {
  degradations?: string[];
  sourceTruth?: PlotLabSourceTruthBrief;
  endpointCandidates?: PlotLabEndpointCandidate[];
  routeCandidates?: PlotLabRouteCandidate[];
  decision?: PlotLabOrchestratorDecision;
  specialistBriefs?: PlotLabSpecialistBrief[];
  creativeRoute?: unknown;
  qa?: PlotLabQAResult;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  preRepairRoute?: unknown;
  finalBatch?: PlotLabConnectedBatch;
}

export interface PlotLabPurposeUnit {
  id: string;
  number: number;
  title: string;
  purposeLine: string;
  incomingPressure: string;
  decisiveMove: string;
  stateDelta: string;
  outgoingHook: string;
  dominantFunction: string;
  changedDimensions: string[];
  scenePhase: string;
  characterFunctions: string[];
  skeletonElementsUsed: string[];
  completeEvent: string;
  meaningfulChange: string;
}

export interface PlotLabPurposeMap {
  format: DocumentOrientation;
  monetizationEpisode: number;
  destination: string;
  centralTransformation: string;
  monetizationDelivery: string;
  units: PlotLabPurposeUnit[];
  warnings: string[];
}

export interface PlotLabConnectedUnit {
  purposeUnitId?: string;
  number: number;
  title?: string;
  cause: string;
  soulConnection: string;
  episodeFunction: string;
  timePhase: string;
  locationFunction: string;
  characterChoice: string;
  consequence: string;
  nextPressure: string;
  emotionalChange: string;
  endingTurn: string;
  cliffhangerType: string;
  relationshipChange: string;
  antagonistPressure: string;
  fidelityProof: string;
  skeletonElementsUsed: string[];
  revelationPurpose: string;
  visiblePlot: string;
}

export interface PlotLabConnectedBatch {
  format: DocumentOrientation;
  version: number;
  units: PlotLabConnectedUnit[];
  seedCoverage: Array<{ element: string; unitNumbers: number[] }>;
  warnings: string[];
}
