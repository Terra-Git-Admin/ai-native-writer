import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiJobs } from "@/lib/db/schema";
import { logEvent } from "@/lib/saveTrace";
import type { PlotLabMessage, PlotLabSessionState } from "@/lib/plot-lab-v2/contracts";
import { DrizzlePlotLabRepository } from "@/lib/plot-lab-v2/repository";
import {
  connectCreativeRoute,
  generateCreativeRoute,
  type CreativeUnit,
  type PlotLabModelChoice,
} from "@/lib/plot-lab-v2/real-ai";

interface PlotLabGenerationInput {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
  resumeStage?: "creative" | "connecting";
  creativeUnits?: CreativeUnit[];
}

const running = new Set<string>();

function publicGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/No decryptable API key|Configure one AI provider/i.test(message)) return message;
  if (/required story range|final format|did not contain units/i.test(message)) {
    return "Levi returned an incomplete batch. Retry generation to get a correctly structured route.";
  }
  return "Levi could not complete this batch. Your interview and source snapshot are safe; try again.";
}

export function startPlotLabGenerationJob(jobId: string): void {
  if (running.has(jobId)) return;
  running.add(jobId);
  void runPlotLabGenerationJob(jobId).finally(() => running.delete(jobId));
}

async function runPlotLabGenerationJob(jobId: string): Promise<void> {
  const repository = new DrizzlePlotLabRepository(db);
  let stage: "creative" | "connecting" = "creative";
  try {
    const job = await db.query.aiJobs.findFirst({ where: eq(aiJobs.id, jobId) });
    if (!job?.inputSnapshotJson || job.status !== "pending") return;
    const input = JSON.parse(job.inputSnapshotJson) as PlotLabGenerationInput;
    if (!input.session || !Array.isArray(input.messages) || !input.model?.modelId) {
      throw new Error("Plot Lab generation input is incomplete.");
    }

    let creativeUnits = input.creativeUnits;
    if (input.resumeStage !== "connecting") {
      await repository.startGenerationStage({ jobId, stage: "creative" });
      logEvent("plot_lab_v2.generation.stage", { jobId, stage: "creative" });
      creativeUnits = await generateCreativeRoute(input);
      await repository.saveGenerationCheckpoint({
        jobId,
        checkpoint: { creativeUnits },
      });
    } else if (!Array.isArray(creativeUnits) || creativeUnits.length === 0) {
      throw new Error("Plot Lab retry is missing its creative checkpoint.");
    }

    stage = "connecting";
    await repository.startGenerationStage({ jobId, stage: "connecting" });
    logEvent("plot_lab_v2.generation.stage", { jobId, stage: "connecting" });
    const batch = await connectCreativeRoute({
      ...input,
      creativeUnits,
      version: (input.session.latestOutputVersion ?? 0) + 1,
    });
    await repository.completeGeneration({ jobId, batch });
    logEvent("plot_lab_v2.generation.completed", {
      jobId,
      units: batch.units.length,
      version: batch.version,
    });
  } catch (error) {
    const publicError = publicGenerationError(error);
    logEvent("plot_lab_v2.generation.failed", {
      jobId,
      stage,
      reason: error instanceof Error ? error.message : String(error),
    });
    try {
      await repository.failGeneration({ jobId, stage, publicError });
    } catch (persistenceError) {
      logEvent("plot_lab_v2.generation.fail_persistence", {
        jobId,
        stage,
        reason: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
      });
    }
  }
}
