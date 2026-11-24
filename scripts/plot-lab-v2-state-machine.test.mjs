import assert from "node:assert/strict";
import {
  assertPlotLabRevision,
  createPlotLabIntakeSession,
  transitionPlotLabSession,
} from "../src/lib/plot-lab-v2/state-machine.ts";
import {
  hashPlotLabActionRequest,
  isPlotLabActionId,
} from "../src/lib/plot-lab-v2/action-idempotency.ts";
import {
  assertPlotLabActionAllowed,
  isPlotLabActionAllowed,
} from "../src/lib/plot-lab-v2/action-policy.ts";
import {
  PLOT_LAB_PACING_REFERENCES,
  PLOT_LAB_PACING_TRAINING_PACK_VERSION,
} from "../src/lib/plot-lab-v2/pacing-training-pack.ts";
import { normalizePurposeMap } from "../src/lib/plot-lab-v2/purpose-map.ts";

function intake(overrides = {}) {
  return {
    ...createPlotLabIntakeSession({
      sessionId: "session-1",
      documentId: "document-1",
      createdBy: "user-1",
      orientation: "portrait",
    }),
    ...overrides,
  };
}

function expectCode(code, fn) {
  assert.throws(fn, (error) => error instanceof Error && error.code === code);
}

function purposeUnit(number, purposeLine) {
  return {
    id: `ep-${number}`,
    number,
    title: `Episode ${number}`,
    purposeLine,
    incomingPressure: "The previous episode's danger is still in motion.",
    decisiveMove: "Karin hides Yuji before the riders reach the riverbank.",
    stateDelta: "Karin is now complicit in Yuji's escape.",
    outgoingHook: "The captain orders the reeds searched.",
    dominantFunction: "commit",
    changedDimensions: ["obligation"],
    scenePhase: "Minutes later at the riverbank.",
    characterFunctions: ["Karin chooses treason to keep Yuji alive."],
    skeletonElementsUsed: [],
  };
}

{
  assert.match(PLOT_LAB_PACING_TRAINING_PACK_VERSION, /^purpose-pacing-v1-/);
  assert.deepEqual(PLOT_LAB_PACING_REFERENCES.map((reference) => reference.story), [
    "Farm Girl", "Nurse", "Prince", "Ring", "Florist", "I Object", "Lift",
  ]);
  assert.equal(PLOT_LAB_PACING_REFERENCES.flatMap((reference) => reference.rhythm).length, 47);
  assert.deepEqual(
    PLOT_LAB_PACING_REFERENCES.filter((reference) => reference.monetizationEpisode === 7).map((reference) => reference.story),
    ["Farm Girl", "Nurse"]
  );
}

{
  const units = Array.from({ length: 7 }, (_, index) => purposeUnit(
    index + 2,
    index === 0
      ? "Episode 1 consequence becomes a contract: The protagonist must cash the immediate Episode 1 pressure, leaving a concrete changed state that forces the lead proves a defining quality."
      : `Karin moves Yuji to refuge ${index + 2}, but the riders close another escape route and force her to risk a new ally.`
  ));
  assert.throws(
    () => normalizePurposeMap({
      units,
    }, "portrait", 8, { destination: "Karin and Yuji return to the besieged kingdom." }),
    /planning instructions instead of an Episode 2 story event/
  );
}

{
  const candidate = {
    units: Array.from({ length: 7 }, (_, index) => ({
      title: `Story turn ${index + 1}`,
      purposeLine: index < 2
        ? "Karin carries Yuji away from the riders and loses the only road back to her forge."
        : `Karin makes consequential story move ${index + 1}, changing what Yuji can safely do next.`,
    })),
  };
  const map = normalizePurposeMap(candidate, "portrait", 8, {
    destination: "Karin and Yuji reach the kingdom as the siege begins.",
    unresolvedPressure: "Armed riders close on the riverbank.",
    requiredSkeletonElements: ["Yuji fakes amnesia."],
  });
  assert.deepEqual(map.units.map((unit) => unit.number), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(map.units[0].incomingPressure, "Armed riders close on the riverbank.");
  assert.deepEqual(map.units[6].skeletonElementsUsed, ["Yuji fakes amnesia."]);
  assert.match(map.warnings.join(" "), /repeat/i, "Duplicate prose should warn instead of killing a readable map.");
}

{
  const session = intake({ revision: 7 });
  assert.doesNotThrow(() => assertPlotLabRevision(session, 7));
  expectCode("SESSION_STALE", () => assertPlotLabRevision(session, 6));
}

{
  assert.equal(isPlotLabActionAllowed("intake", "start"), true);
  assert.equal(isPlotLabActionAllowed("interview", "request_generation"), true);
  assert.equal(isPlotLabActionAllowed("purpose_review", "revise_purpose_map"), true);
  assert.equal(isPlotLabActionAllowed("purpose_review", "approve_purpose_map"), true);
  assert.equal(isPlotLabActionAllowed("purpose_review", "request_generation"), false);
  assert.equal(isPlotLabActionAllowed("complete", "chat"), true);
  assert.equal(isPlotLabActionAllowed("complete", "accept_output"), true);
  assert.equal(isPlotLabActionAllowed("complete", "answer"), false);
  expectCode("INVALID_PHASE", () => assertPlotLabActionAllowed(
    intake({ phase: "complete" }),
    { kind: "edit_answer", answerMessageId: "answer-1", text: "Changed" }
  ));
  assert.doesNotThrow(() => assertPlotLabActionAllowed(
    intake({ phase: "creative", activeJobId: "job-1" }),
    { kind: "restart" }
  ));
  expectCode("ACTION_IN_PROGRESS", () => assertPlotLabActionAllowed(
    intake({ phase: "complete", activeJobId: "job-1", latestOutputVersion: 1 }),
    { kind: "regenerate_all", instruction: "Make it sharper" }
  ));
  const failed = intake({ phase: "recoverable_error", activeJobId: "job-failed", failedStage: "creative" });
  assert.doesNotThrow(() => assertPlotLabActionAllowed(
    failed,
    { kind: "retry_failed_stage", jobId: "job-failed" }
  ));
  expectCode("ACTION_IN_PROGRESS", () => assertPlotLabActionAllowed(
    failed,
    { kind: "continue_generation_with_snapshot" }
  ));
}

{
  let state = intake({ phase: "interview", revision: 2 });
  state = transitionPlotLabSession(state, { type: "generation_queued", jobId: "purpose-job" });
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "purpose-job", stage: "purpose_planning" });
  assert.equal(state.phase, "orchestrating");
  state = transitionPlotLabSession(state, { type: "purpose_map_completed", jobId: "purpose-job" });
  assert.equal(state.phase, "purpose_review");
  assert.equal(state.activeJobId, undefined);
  state = transitionPlotLabSession(state, { type: "generation_queued", jobId: "writer-job" });
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "writer-job", stage: "plot_writing" });
  assert.equal(state.phase, "creative");
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "writer-job", stage: "connecting" });
  state = transitionPlotLabSession(state, { type: "job_completed", jobId: "writer-job", outputVersion: 1 });
  assert.equal(state.phase, "complete");
}

{
  const actionId = "019ab123-4567-789a-8bcd-ef0123456789";
  assert.equal(isPlotLabActionId(actionId), true);
  assert.equal(isPlotLabActionId("not-a-uuid"), false);
  const scope = { documentId: "document-1", userId: "user-1" };
  const first = hashPlotLabActionRequest(scope, {
    actionId,
    expectedRevision: 2,
    action: { kind: "start", seed: "A reunion", references: [] },
  });
  const replay = hashPlotLabActionRequest(scope, {
    actionId,
    expectedRevision: 2,
    action: { references: [], seed: "A reunion", kind: "start" },
  });
  const changed = hashPlotLabActionRequest(scope, {
    actionId,
    expectedRevision: 2,
    action: { kind: "start", seed: "A betrayal", references: [] },
  });
  assert.equal(first, replay);
  assert.notEqual(first, changed);
}

{
  const started = transitionPlotLabSession(intake(), { type: "session_started", seed: "  A costly reunion  " });
  assert.equal(started.phase, "interview");
  assert.equal(started.seed, "A costly reunion");
  assert.equal(started.revision, 1);
}

{
  const interview = intake({ phase: "interview", revision: 4 });
  const reserved = transitionPlotLabSession(interview, { type: "sync_action_reserved", actionId: "action-1" });
  assert.equal(reserved.pendingSyncActionId, "action-1");
  assert.equal(reserved.revision, 5);
  expectCode("ACTION_IN_PROGRESS", () => transitionPlotLabSession(reserved, {
    type: "sync_action_reserved",
    actionId: "action-2",
  }));
  const finalized = transitionPlotLabSession(reserved, { type: "sync_action_finalized", actionId: "action-1" });
  assert.equal(finalized.pendingSyncActionId, undefined);
  assert.equal(finalized.revision, 6);
}

{
  let state = intake({ phase: "interview", revision: 2 });
  state = transitionPlotLabSession(state, { type: "generation_queued", jobId: "job-1" });
  assert.equal(state.phase, "queued");
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "job-1", stage: "source_truth" });
  assert.equal(state.phase, "orchestrating");
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "job-1", stage: "endpoint_exploration" });
  assert.equal(state.phase, "orchestrating");
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "job-1", stage: "creative_authoring" });
  assert.equal(state.phase, "creative");
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "job-1", stage: "holistic_qa" });
  assert.equal(state.phase, "reviewing");
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "job-1", stage: "connecting" });
  assert.equal(state.phase, "connecting");
  state = transitionPlotLabSession(state, { type: "job_completed", jobId: "job-1", outputVersion: 1 });
  assert.equal(state.phase, "complete");
  assert.equal(state.latestOutputVersion, 1);
  assert.equal(state.activeJobId, undefined);
}

{
  let state = intake({ phase: "complete", latestOutputVersion: 3 });
  state = transitionPlotLabSession(state, { type: "generation_queued", jobId: "job-2" });
  state = transitionPlotLabSession(state, { type: "job_stage_started", jobId: "job-2", stage: "unit_creative" });
  state = transitionPlotLabSession(state, { type: "job_stage_failed", jobId: "job-2", stage: "continuity" });
  assert.equal(state.phase, "recoverable_error");
  assert.equal(state.failedStage, "continuity");
  state = transitionPlotLabSession(state, { type: "generation_queued", jobId: "job-retry" });
  assert.equal(state.phase, "queued");
  assert.equal(state.activeJobId, "job-retry");
  assert.equal(state.failedStage, undefined);
}

{
  const running = intake({ phase: "creative", activeJobId: "job-live" });
  expectCode("JOB_MISMATCH", () => transitionPlotLabSession(running, {
    type: "job_completed",
    jobId: "job-late",
    outputVersion: 1,
  }));
}

{
  const archived = transitionPlotLabSession(intake({ phase: "interview" }), {
    type: "session_archived",
    archivedAt: "2026-11-20T00:00:00.000Z",
  });
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedAt, "2026-11-20T00:00:00.000Z");
  expectCode("SESSION_ARCHIVED", () => transitionPlotLabSession(archived, {
    type: "sync_action_reserved",
    actionId: "too-late",
  }));
}

console.log("Plot Lab V2 state-machine checks passed");
