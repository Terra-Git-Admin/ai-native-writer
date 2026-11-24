import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiJobs } from "@/lib/db/schema";
import { logEvent } from "@/lib/saveTrace";
import type { PlotLabGenerationStage, PlotLabMessage, PlotLabOrchestrationArtifacts, PlotLabSessionState, PlotLabSpecialistBrief } from "@/lib/plot-lab-v2/contracts";
import { DrizzlePlotLabRepository } from "@/lib/plot-lab-v2/repository";
import { connectCreativeRoute, exploreEndpoints, exploreRoutes, generateCreativeRoute, generateSourceTruth, generateSpecialistBrief, repairCreativeRoute, runHolisticQA, selectRouteAndSpecialists, type CreativeRoute, type PlotLabModelChoice } from "@/lib/plot-lab-v2/real-ai";

interface PlotLabGenerationInput {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
  resumeStage?: PlotLabGenerationStage;
  artifacts?: PlotLabOrchestrationArtifacts;
  mutationKind?: string;
  proposalId?: string;
  confirmedInstruction?: string;
}

const running = new Set<string>();
const STAGES: PlotLabGenerationStage[] = ["source_truth", "endpoint_exploration", "route_exploration", "specialist_planning", "creative_authoring", "holistic_qa", "targeted_repair", "connecting"];

function publicGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/No decryptable API key|Configure one AI provider/i.test(message)) return message;
  if (/required story range|final format|did not contain|two candidates|unknown route/i.test(message)) return "Levi returned incomplete structured output. Retry the failed stage; completed planning artifacts are safe.";
  return "Levi could not complete this batch. Your source, interview, and completed planning artifacts are safe; try again.";
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
    const artifacts: PlotLabOrchestrationArtifacts = { ...(input.artifacts ?? {}) };
    const startIndex = input.resumeStage ? Math.max(0, STAGES.indexOf(input.resumeStage)) : 0;
    const shouldRun = (candidate: PlotLabGenerationStage) => STAGES.indexOf(candidate) >= startIndex;
    const begin = async (candidate: PlotLabGenerationStage) => {
      stage = candidate;
      await repository.startGenerationStage({ jobId, stage });
      logEvent("plot_lab_v2.generation.stage", { jobId, stage });
    };
    const checkpoint = async () => repository.saveGenerationCheckpoint({ jobId, checkpoint: { artifacts } });

    if (shouldRun("source_truth")) {
      await begin("source_truth");
      artifacts.sourceTruth = await generateSourceTruth(input);
      await checkpoint();
    }
    if (!artifacts.sourceTruth) throw new Error("Plot Lab retry is missing source truth.");

    if (shouldRun("endpoint_exploration")) {
      await begin("endpoint_exploration");
      artifacts.endpointCandidates = await exploreEndpoints({ sourceTruth: artifacts.sourceTruth, orientation: input.session.orientation, model: input.model, revisionInstruction: input.confirmedInstruction });
      await checkpoint();
    }
    if (!artifacts.endpointCandidates) throw new Error("Plot Lab retry is missing endpoint candidates.");

    if (shouldRun("route_exploration")) {
      await begin("route_exploration");
      artifacts.routeCandidates = await exploreRoutes({ sourceTruth: artifacts.sourceTruth, endpointCandidates: artifacts.endpointCandidates, orientation: input.session.orientation, model: input.model, revisionInstruction: input.confirmedInstruction });
      await checkpoint();
    }
    if (!artifacts.routeCandidates) throw new Error("Plot Lab retry is missing route candidates.");

    if (shouldRun("specialist_planning")) {
      await begin("specialist_planning");
      artifacts.decision = await selectRouteAndSpecialists({ sourceTruth: artifacts.sourceTruth, endpointCandidates: artifacts.endpointCandidates, routeCandidates: artifacts.routeCandidates, model: input.model, revisionInstruction: input.confirmedInstruction });
      const selectedRoute = artifacts.routeCandidates.find((route) => route.id === artifacts.decision!.selectedRouteId)!;
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
          logEvent("plot_lab_v2.generation.specialist_degraded", { jobId, role: item.role, reason: specialistError instanceof Error ? specialistError.message : String(specialistError) });
        }
      }
      await checkpoint();
    }
    if (!artifacts.decision || !artifacts.specialistBriefs) throw new Error("Plot Lab retry is missing Levi's route decision.");
    const selectedRoute = artifacts.routeCandidates.find((route) => route.id === artifacts.decision!.selectedRouteId)!;

    let creativeRoute = artifacts.creativeRoute as CreativeRoute | undefined;
    if (shouldRun("creative_authoring")) {
      await begin("creative_authoring");
      creativeRoute = await generateCreativeRoute({ ...input, orchestration: { sourceTruth: artifacts.sourceTruth, endpointCandidates: artifacts.endpointCandidates, routeCandidates: artifacts.routeCandidates, decision: artifacts.decision, specialistBriefs: artifacts.specialistBriefs, revisionInstruction: input.confirmedInstruction } });
      artifacts.creativeRoute = creativeRoute;
      await checkpoint();
    }
    if (!creativeRoute) throw new Error("Plot Lab retry is missing the creative route.");

    if (shouldRun("holistic_qa")) {
      await begin("holistic_qa");
      try {
        artifacts.qa = await runHolisticQA({ sourceTruth: artifacts.sourceTruth, selectedRoute, creativeRoute, model: input.model });
      } catch (qaError) {
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
    const batch = await connectCreativeRoute({ ...input, creativeRoute, version: (input.session.latestOutputVersion ?? 0) + 1, revisionInstruction: connectorInstruction || undefined });
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
