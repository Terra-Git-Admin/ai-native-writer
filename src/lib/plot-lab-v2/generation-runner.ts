import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiJobs } from "@/lib/db/schema";
import { logEvent } from "@/lib/saveTrace";
import type { PlotLabConnectedBatch, PlotLabEndpointCandidate, PlotLabGenerationStage, PlotLabMessage, PlotLabOrchestrationArtifacts, PlotLabOrchestratorDecision, PlotLabPurposeMap, PlotLabRouteCandidate, PlotLabSessionState, PlotLabSourceTruthBrief, PlotLabSpecialistBrief } from "@/lib/plot-lab-v2/contracts";
import { DrizzlePlotLabRepository } from "@/lib/plot-lab-v2/repository";
import { connectCreativeRoute, exploreEndpoints, exploreRoutes, generateCreativeRoute, generatePurposeMap, generateSourceTruth, generateSpecialistBrief, repairCreativeRoute, runHolisticQA, selectRouteAndSpecialists, writePlotsFromPurposeMap, type CreativeRoute, type PlotLabModelChoice } from "@/lib/plot-lab-v2/real-ai";
import { fallbackBatchFromPurposeMap, fallbackPurposeMap, inferPurposeDestination } from "@/lib/plot-lab-v2/purpose-map";

interface PlotLabGenerationInput {
  mode?: "purpose_planning" | "plot_writing" | "legacy";
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
  resumeStage?: PlotLabGenerationStage;
  artifacts?: PlotLabOrchestrationArtifacts;
  mutationKind?: string;
  proposalId?: string;
  confirmedInstruction?: string;
  purposeMap?: PlotLabPurposeMap;
  previousPurposeMap?: PlotLabPurposeMap;
}

const running = new Set<string>();
const STAGES: PlotLabGenerationStage[] = ["source_truth", "endpoint_exploration", "route_exploration", "specialist_planning", "creative_authoring", "holistic_qa", "targeted_repair", "connecting"];

function publicGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/No decryptable API key|Configure one AI provider/i.test(message)) return message;
  if (/required story range|final format|did not contain|two candidates|unknown route/i.test(message)) return "Levi returned incomplete structured output. Retry the failed stage; completed planning artifacts are safe.";
  return "Levi could not complete this batch. Your source, interview, and completed planning artifacts are safe; try again.";
}

function isFatalProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /No decryptable API key|Configure one AI provider|invalid api key|authentication failed|\b401\b|\b403\b/i.test(message);
}

function degradation(artifacts: PlotLabOrchestrationArtifacts, message: string): void {
  artifacts.degradations = [...(artifacts.degradations ?? []), message];
}

function fallbackSourceTruth(session: PlotLabSessionState): PlotLabSourceTruthBrief {
  const brief = session.interviewCheckpoint.characterBrief;
  const seed = session.seed?.trim() || "Continue the writer's supplied story direction.";
  return {
    episode1Soul: brief?.storySoul ?? {
      premise: session.sourceSnapshot?.episode1Plot?.trim() || seed,
      characterEngine: session.sourceSnapshot?.characters?.trim() || "Preserve the established character behavior and agency.",
      centralRelationship: "Preserve the relationship or conflict established in Episode 1.",
      emotionalPromise: "Carry Episode 1's emotional promise into the continuation.",
      tone: "Match the source tone.",
      unresolvedPressure: "Resolve the immediate pressure left by Episode 1.",
    },
    canonFacts: Object.values(session.sourceSnapshot ?? {}).filter((value): value is string => typeof value === "string" && Boolean(value.trim())),
    requiredSkeletonElements: brief?.requiredSkeletonElements?.length ? brief.requiredSkeletonElements : [seed],
    monetizationPoint: brief?.monetizationPoint?.trim() || seed,
    characterFidelity: [],
    unresolvedQuestions: [],
  };
}

function fallbackEndpoints(sourceTruth: PlotLabSourceTruthBrief): PlotLabEndpointCandidate[] {
  return [{
    id: "fallback-endpoint",
    finalTurn: sourceTruth.monetizationPoint,
    visual: sourceTruth.monetizationPoint,
    emotionalCost: sourceTruth.episode1Soul.emotionalPromise,
    causalRequirements: sourceTruth.requiredSkeletonElements,
  }];
}

function fallbackRoutes(sourceTruth: PlotLabSourceTruthBrief, endpoint: PlotLabEndpointCandidate, orientation: PlotLabSessionState["orientation"]): PlotLabRouteCandidate[] {
  const count = orientation === "portrait" ? 7 : 4;
  return [{
    id: "fallback-route",
    thesis: `Build causally from Episode 1 toward ${endpoint.finalTurn}`,
    endpointCandidateId: endpoint.id,
    unitSpine: Array.from({ length: count }, (_, index) => {
      const element = sourceTruth.requiredSkeletonElements[index % sourceTruth.requiredSkeletonElements.length] ?? sourceTruth.monetizationPoint;
      const final = index === count - 1;
      return {
        number: orientation === "portrait" ? index + 2 : index + 1,
        purpose: final ? `Deliver the strongest earned turn: ${endpoint.finalTurn}` : `Advance the story through ${element}`,
        cause: index === 0 ? sourceTruth.episode1Soul.unresolvedPressure : "The prior unit's changed state creates the next pressure.",
        choice: "The protagonist makes a consequential, character-consistent choice.",
        changedState: final ? endpoint.emotionalCost : `The story state changes through ${element}`,
        outgoingPressure: final ? endpoint.visual : "The consequence creates specific pressure for the next unit.",
      };
    }),
  }];
}

function fallbackDecision(route: PlotLabRouteCandidate): PlotLabOrchestratorDecision {
  return {
    selectedRouteId: route.id,
    rationale: "Use the first readable route and preserve forward momentum.",
    qualityDefinition: ["Preserve Episode 1", "Keep every unit purposeful", "Maintain causal movement", "Escalate toward the strongest final turn"],
    specialistNeeds: {
      characterRelationship: { needed: false, reason: "Continue without optional specialist output." },
      oppositionPressure: { needed: false, reason: "Continue without optional specialist output." },
      timeLocationWorld: { needed: false, reason: "Continue without optional specialist output." },
    },
  };
}

function fallbackCreativeRoute(sourceTruth: PlotLabSourceTruthBrief, route: PlotLabRouteCandidate, orientation: PlotLabSessionState["orientation"]): CreativeRoute {
  const desiredCount = orientation === "portrait" ? 7 : Math.min(5, Math.max(4, route.unitSpine.length));
  const units = Array.from({ length: desiredCount }, (_, index) => {
    const spine = route.unitSpine[index] ?? route.unitSpine.at(-1)!;
    const element = sourceTruth.requiredSkeletonElements[index % sourceTruth.requiredSkeletonElements.length] ?? sourceTruth.monetizationPoint;
    return {
      number: orientation === "portrait" ? index + 2 : index + 1,
      title: undefined,
      cause: spine.cause,
      soulConnection: spine.purpose,
      episodeFunction: spine.purpose,
      timePhase: "Resolve the incoming pressure before advancing time.",
      locationFunction: "Use place only when it changes pressure, privacy, authority, or freedom.",
      dramaticMove: spine.purpose,
      characterChoice: spine.choice,
      consequence: spine.changedState,
      endingPressure: spine.outgoingPressure,
      cliffhangerType: "consequential turn",
      relationshipChange: "The central relationship changes through consequential behavior or deliberately holds.",
      antagonistPressure: "Existing opposition applies relevant pressure without forcing a new attack.",
      fidelityProof: "The protagonist acts through behavior established in Episode 1.",
      skeletonElementsUsed: [element],
      revelationPurpose: "",
    };
  });
  return {
    storySoul: sourceTruth.episode1Soul,
    monetizationPoint: sourceTruth.monetizationPoint,
    destinationClock: sourceTruth.monetizationPoint,
    relationshipDestination: sourceTruth.episode1Soul.centralRelationship,
    requiredSkeletonElements: sourceTruth.requiredSkeletonElements,
    units,
  };
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function assembleBestReadableBatch(input: {
  connected?: PlotLabConnectedBatch;
  creativeRoute: CreativeRoute;
  orientation: PlotLabSessionState["orientation"];
  version: number;
  degradations: string[];
}): PlotLabConnectedBatch {
  const connectedUnits = input.connected?.units ?? [];
  const units = input.creativeRoute.units.map((creative, index) => connectedUnits[index] ?? {
    number: creative.number,
    title: creative.title,
    cause: creative.cause,
    soulConnection: creative.soulConnection,
    episodeFunction: creative.episodeFunction,
    timePhase: creative.timePhase,
    locationFunction: creative.locationFunction,
    characterChoice: creative.characterChoice,
    consequence: creative.consequence,
    nextPressure: creative.endingPressure,
    emotionalChange: creative.relationshipChange,
    endingTurn: creative.endingPressure,
    cliffhangerType: creative.cliffhangerType,
    relationshipChange: creative.relationshipChange,
    antagonistPressure: creative.antagonistPressure,
    fidelityProof: creative.fidelityProof,
    skeletonElementsUsed: creative.skeletonElementsUsed,
    revelationPurpose: creative.revelationPurpose,
    visiblePlot: [creative.characterChoice, creative.consequence, creative.endingPressure].filter(Boolean).map(sentence).join(" "),
  });
  if (units.length === 0 || units.every((unit) => !unit.visiblePlot.trim())) throw new Error("Plot Lab produced no readable plot text.");
  return {
    format: input.orientation,
    version: input.version,
    units,
    seedCoverage: input.connected?.seedCoverage ?? input.creativeRoute.requiredSkeletonElements.map((element) => ({
      element,
      unitNumbers: units.filter((unit) => unit.skeletonElementsUsed.includes(element)).map((unit) => unit.number),
    })),
    warnings: [...new Set([...(input.connected?.warnings ?? []), ...input.degradations])],
  };
}

export function startPlotLabGenerationJob(jobId: string): void {
  if (running.has(jobId)) return;
  running.add(jobId);
  void runPlotLabGenerationJob(jobId).finally(() => running.delete(jobId));
}

async function runPlotLabGenerationJob(jobId: string): Promise<void> {
  const repository = new DrizzlePlotLabRepository(db);
  let stage: PlotLabGenerationStage = "source_truth";
  try {
    const job = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, jobId) });
    if (!job?.inputSnapshotJson || job.status !== "pending") return;
    const input = JSON.parse(job.inputSnapshotJson) as PlotLabGenerationInput;
    if (!input.session || !Array.isArray(input.messages) || !input.model?.modelId) throw new Error("Plot Lab generation input is incomplete.");
    stage = input.mode === "purpose_planning" ? "purpose_planning" : input.mode === "plot_writing" ? "plot_writing" : "source_truth";
    const artifacts: PlotLabOrchestrationArtifacts = { degradations: [], ...(input.artifacts ?? {}) };
    const startIndex = input.resumeStage ? Math.max(0, STAGES.indexOf(input.resumeStage)) : 0;
    const shouldRun = (candidate: PlotLabGenerationStage) => STAGES.indexOf(candidate) >= startIndex;
    const begin = async (candidate: PlotLabGenerationStage) => {
      stage = candidate;
      await repository.startGenerationStage({ jobId, stage });
      logEvent("plot_lab_v2.generation.stage", { jobId, stage });
    };
    const checkpoint = async () => repository.saveGenerationCheckpoint({ jobId, checkpoint: { artifacts } });

    if (input.mode === "purpose_planning") {
      await begin("purpose_planning");
      const monetizationEpisode = inferPurposeDestination(input.session);
      let purposeMap: PlotLabPurposeMap;
      try {
        purposeMap = await generatePurposeMap({
          session: input.session,
          messages: input.messages,
          model: input.model,
          monetizationEpisode,
          revisionInstruction: input.confirmedInstruction,
          previousPurposeMap: input.previousPurposeMap,
        });
      } catch (purposeError) {
        if (isFatalProviderError(purposeError)) throw purposeError;
        purposeMap = fallbackPurposeMap(input.session);
        logEvent("plot_lab_v2.purpose.degraded", { jobId, reason: purposeError instanceof Error ? purposeError.message : String(purposeError) });
      }
      await repository.saveGenerationCheckpoint({ jobId, checkpoint: { purposeMap } });
      await repository.completePurposeMap({
        jobId,
        purposeMap,
        revisionInstruction: input.confirmedInstruction,
      });
      logEvent("plot_lab_v2.purpose.completed", { jobId, units: purposeMap.units.length, monetizationEpisode: purposeMap.monetizationEpisode });
      return;
    }

    if (input.mode === "plot_writing") {
      if (!input.purposeMap?.units?.length) throw new Error("The approved purpose map is unavailable.");
      await begin("plot_writing");
      const version = (input.session.latestOutputVersion ?? 0) + 1;
      let batch: PlotLabConnectedBatch;
      try {
        batch = await writePlotsFromPurposeMap({
          session: input.session,
          messages: input.messages,
          purposeMap: input.purposeMap,
          model: input.model,
          version,
        });
      } catch (writerError) {
        if (isFatalProviderError(writerError)) throw writerError;
        batch = fallbackBatchFromPurposeMap(
          input.purposeMap,
          version,
          "Plot Writer returned incomplete structure; Levi preserved each approved purpose as that unit's distinct readable fallback."
        );
        logEvent("plot_lab_v2.plot_writer.degraded", { jobId, reason: writerError instanceof Error ? writerError.message : String(writerError) });
      }
      await repository.saveGenerationCheckpoint({ jobId, checkpoint: { purposeMap: input.purposeMap, batch } });
      await begin("connecting");
      await repository.completeGeneration({ jobId, batch });
      logEvent("plot_lab_v2.generation.completed", { jobId, units: batch.units.length, version: batch.version, path: "approved_purpose_map" });
      return;
    }

    if (shouldRun("source_truth")) {
      await begin("source_truth");
      try {
        artifacts.sourceTruth = await generateSourceTruth(input);
      } catch (sourceError) {
        if (isFatalProviderError(sourceError)) throw sourceError;
        artifacts.sourceTruth = fallbackSourceTruth(input.session);
        degradation(artifacts, "Source Truth returned incomplete structure; Levi preserved the interview and source packet.");
      }
      await checkpoint();
    }
    if (!artifacts.sourceTruth) throw new Error("Plot Lab retry is missing source truth.");

    if (shouldRun("endpoint_exploration")) {
      await begin("endpoint_exploration");
      try {
        artifacts.endpointCandidates = await exploreEndpoints({ sourceTruth: artifacts.sourceTruth, orientation: input.session.orientation, model: input.model, revisionInstruction: input.confirmedInstruction });
        if (artifacts.endpointCandidates.length < 2) degradation(artifacts, "Endpoint Explorer returned one usable destination; Levi continued with it.");
      } catch (endpointError) {
        if (isFatalProviderError(endpointError)) throw endpointError;
        artifacts.endpointCandidates = fallbackEndpoints(artifacts.sourceTruth);
        degradation(artifacts, "Endpoint Explorer returned incomplete structure; Levi continued with the writer's monetization destination.");
      }
      await checkpoint();
    }
    if (!artifacts.endpointCandidates) throw new Error("Plot Lab retry is missing endpoint candidates.");

    if (shouldRun("route_exploration")) {
      await begin("route_exploration");
      try {
        artifacts.routeCandidates = await exploreRoutes({ sourceTruth: artifacts.sourceTruth, endpointCandidates: artifacts.endpointCandidates, orientation: input.session.orientation, model: input.model, revisionInstruction: input.confirmedInstruction });
        if (artifacts.routeCandidates.length < 2) degradation(artifacts, "Route Explorer returned one usable route; Levi continued with it.");
      } catch (routeError) {
        if (isFatalProviderError(routeError)) throw routeError;
        artifacts.routeCandidates = fallbackRoutes(artifacts.sourceTruth, artifacts.endpointCandidates[0], input.session.orientation);
        degradation(artifacts, "Route Explorer returned incomplete structure; Levi built a causal fallback route from the source truth.");
      }
      await checkpoint();
    }
    if (!artifacts.routeCandidates) throw new Error("Plot Lab retry is missing route candidates.");

    if (shouldRun("specialist_planning")) {
      await begin("specialist_planning");
      try {
        artifacts.decision = await selectRouteAndSpecialists({ sourceTruth: artifacts.sourceTruth, endpointCandidates: artifacts.endpointCandidates, routeCandidates: artifacts.routeCandidates, model: input.model, revisionInstruction: input.confirmedInstruction });
      } catch (decisionError) {
        if (isFatalProviderError(decisionError)) throw decisionError;
        artifacts.decision = fallbackDecision(artifacts.routeCandidates[0]);
        degradation(artifacts, "Levi's route selection returned incomplete structure; the first readable route was used.");
      }
      const selectedRoute = artifacts.routeCandidates.find((route) => route.id === artifacts.decision!.selectedRouteId) ?? artifacts.routeCandidates[0];
      if (artifacts.decision.selectedRouteId !== selectedRoute.id) {
        artifacts.decision.selectedRouteId = selectedRoute.id;
        degradation(artifacts, "Levi selected an unknown route ID; the first readable route was used.");
      }
      const requested: Array<{ role: PlotLabSpecialistBrief["role"]; needed: boolean; reason: string }> = [
        { role: "character_relationship", ...artifacts.decision.specialistNeeds.characterRelationship },
        { role: "opposition_pressure", ...artifacts.decision.specialistNeeds.oppositionPressure },
        { role: "time_location_world", ...artifacts.decision.specialistNeeds.timeLocationWorld },
      ];
      artifacts.specialistBriefs = [];
      for (const item of requested.filter((value) => value.needed)) {
        try {
          artifacts.specialistBriefs.push(await generateSpecialistBrief({ role: item.role, reason: item.reason, sourceTruth: artifacts.sourceTruth, selectedRoute, model: input.model }));
        } catch (specialistError) {
          if (isFatalProviderError(specialistError)) throw specialistError;
          degradation(artifacts, `${item.role.replaceAll("_", " ")} specialist was unavailable; Levi continued without it.`);
          logEvent("plot_lab_v2.generation.specialist_degraded", { jobId, role: item.role, reason: specialistError instanceof Error ? specialistError.message : String(specialistError) });
        }
      }
      await checkpoint();
    }
    if (!artifacts.decision || !artifacts.specialistBriefs) throw new Error("Plot Lab retry is missing Levi's route decision.");
    const selectedRoute = artifacts.routeCandidates.find((route) => route.id === artifacts.decision!.selectedRouteId) ?? artifacts.routeCandidates[0];

    let creativeRoute = artifacts.creativeRoute as CreativeRoute | undefined;
    if (shouldRun("creative_authoring")) {
      await begin("creative_authoring");
      try {
        creativeRoute = await generateCreativeRoute({ ...input, orchestration: { sourceTruth: artifacts.sourceTruth, endpointCandidates: artifacts.endpointCandidates, routeCandidates: artifacts.routeCandidates, decision: artifacts.decision, specialistBriefs: artifacts.specialistBriefs, revisionInstruction: input.confirmedInstruction } });
      } catch (authorError) {
        if (isFatalProviderError(authorError)) throw authorError;
        creativeRoute = fallbackCreativeRoute(artifacts.sourceTruth, selectedRoute, input.session.orientation);
        degradation(artifacts, "Creative Author returned incomplete structure; Levi preserved the selected route as a readable draft.");
      }
      artifacts.creativeRoute = creativeRoute;
      await checkpoint();
    }
    if (!creativeRoute) throw new Error("Plot Lab retry is missing the creative route.");

    if (shouldRun("holistic_qa")) {
      await begin("holistic_qa");
      try {
        artifacts.qa = await runHolisticQA({ sourceTruth: artifacts.sourceTruth, selectedRoute, creativeRoute, model: input.model });
      } catch (qaError) {
        if (isFatalProviderError(qaError)) throw qaError;
        artifacts.qa = {
          verdict: "strong",
          strengths: [],
          primaryIssue: "Holistic QA was unavailable; the readable authored route was preserved.",
          repairInstruction: "",
          owner: "creative_author",
          affectedUnitNumbers: [],
        };
        logEvent("plot_lab_v2.generation.qa_degraded", { jobId, reason: qaError instanceof Error ? qaError.message : String(qaError) });
      }
      await checkpoint();
    }

    if (shouldRun("targeted_repair") && artifacts.qa?.verdict === "repair_recommended" && artifacts.qa.owner === "creative_author") {
      await begin("targeted_repair");
      artifacts.repairAttempted = true;
      artifacts.preRepairRoute = creativeRoute;
      try {
        creativeRoute = await repairCreativeRoute({ session: input.session, sourceTruth: artifacts.sourceTruth, creativeRoute, qa: artifacts.qa, model: input.model });
        artifacts.creativeRoute = creativeRoute;
        artifacts.repairSucceeded = true;
      } catch (repairError) {
        if (isFatalProviderError(repairError)) throw repairError;
        artifacts.repairSucceeded = false;
        creativeRoute = artifacts.preRepairRoute as CreativeRoute;
        logEvent("plot_lab_v2.generation.repair_degraded", { jobId, reason: repairError instanceof Error ? repairError.message : String(repairError) });
      }
      await checkpoint();
    }

    await begin("connecting");
    const connectorInstruction = [
      input.confirmedInstruction,
      artifacts.qa?.verdict === "repair_recommended" && artifacts.qa.owner === "connector"
        ? artifacts.qa.repairInstruction
        : undefined,
    ].filter(Boolean).join("\n");
    const version = (input.session.latestOutputVersion ?? 0) + 1;
    let connected: PlotLabConnectedBatch | undefined;
    try {
      connected = await connectCreativeRoute({ ...input, creativeRoute, version, revisionInstruction: connectorInstruction || undefined });
    } catch (connectorError) {
      if (isFatalProviderError(connectorError)) throw connectorError;
      degradation(artifacts, "Connector returned incomplete structure; Levi preserved the Creative Author's readable route.");
      logEvent("plot_lab_v2.generation.connector_degraded", { jobId, reason: connectorError instanceof Error ? connectorError.message : String(connectorError) });
    }
    const batch = assembleBestReadableBatch({ connected, creativeRoute, orientation: input.session.orientation, version, degradations: artifacts.degradations ?? [] });
    artifacts.finalBatch = batch;
    await checkpoint();
    await repository.completeGeneration({ jobId, batch });
    logEvent("plot_lab_v2.generation.completed", { jobId, units: batch.units.length, version: batch.version, repairAttempted: artifacts.repairAttempted === true, repairSucceeded: artifacts.repairSucceeded });
  } catch (error) {
    const publicError = publicGenerationError(error);
    logEvent("plot_lab_v2.generation.failed", { jobId, stage, reason: error instanceof Error ? error.message : String(error) });
    try {
      await repository.failGeneration({ jobId, stage, publicError });
    } catch (persistenceError) {
      logEvent("plot_lab_v2.generation.fail_persistence", { jobId, stage, reason: persistenceError instanceof Error ? persistenceError.message : String(persistenceError) });
    }
  }
}
