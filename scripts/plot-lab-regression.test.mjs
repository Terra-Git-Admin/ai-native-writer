import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyPlotLabUserIntent,
  commitPlotLabAssistantTurn,
  createInitialPlotLabControllerState,
  planPlotLabAssistantTurn,
} from "../src/lib/plot-lab/controller.ts";
import { selectPlotLabSpecialist, specialistOptionsToActions } from "../src/lib/plot-lab/orchestration.ts";

function testOpeningActions() {
  const state = createInitialPlotLabControllerState();

  assert.equal(state.turnPlan.questionMode, "fixed_actions");
  assert.equal(state.turnPlan.allowModelOptions, false);
  assert.deepEqual(
    state.turnPlan.actions.map((action) => action.kind),
    ["confirm_opening", "add_context", "custom_answer"]
  );
  assert.ok(state.turnPlan.actions.every((action) => !("key" in action)));
}

function testTypedDiscovery() {
  const opening = createInitialPlotLabControllerState();
  const discovery = planPlotLabAssistantTurn(opening, "Yes, this is right");

  assert.equal(discovery.phase, "protagonist_discovery");
  assert.equal(discovery.turnPlan.questionMode, "typed");
  assert.equal(discovery.turnPlan.allowModelOptions, false);
  assert.deepEqual(discovery.turnPlan.actions.map((action) => action.kind), ["custom_answer"]);
}

function testStage1DiscoveryOptionsAcrossPipeline() {
  const protagonistQ1 = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right");
  assert.equal(protagonistQ1.turnPlan.allowModelOptions, false);

  const protagonistQ2 = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(protagonistQ1), "Her joy in music");
  assert.equal(protagonistQ2.turnPlan.allowModelOptions, false);

  const primaryQ1 = planPlotLabAssistantTurn({
    ...protagonistQ1,
    phase: "character_discovery",
    focusId: "primary_counterpart",
    focusIndex: 1,
    questionsInFocus: 0,
  }, "next");
  assert.equal(primaryQ1.turnPlan.allowModelOptions, false);

  const relationshipQ1 = planPlotLabAssistantTurn({
    ...protagonistQ1,
    phase: "relationship_discovery",
    focusId: "relationship_core",
    focusIndex: 3,
    questionsInFocus: 0,
  }, "next");
  assert.equal(relationshipQ1.turnPlan.allowModelOptions, false);

  const monetizationGate = {
    ...createInitialPlotLabControllerState(),
    phase: "plot_transition_gate",
    focusId: "plot",
    focusIndex: 4,
    assistantTurnKind: "character_board_summary",
    questionVector: "lock_review",
    questionMode: "fixed_actions",
  };
  const monetizationPlanned = planPlotLabAssistantTurn(monetizationGate, "Move into plot");
  assert.equal(monetizationPlanned.turnPlan.allowModelOptions, false);

  const checkpointPlanned = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(protagonistQ2), "This is the answer");
  assert.equal(checkpointPlanned.assistantTurnKind, "checkpoint_summary");
  assert.equal(checkpointPlanned.turnPlan.allowModelOptions, false);
}

function testStructuredOptionsBecomeActions() {
  const discovery = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right");
  const actions = specialistOptionsToActions({
    specialist: "plot_lab_character_analyst",
    status: "needs_input",
    objective: "",
    lockedContextUsed: [],
    evidenceUsed: [],
    recommendedMove: "show_options",
    visibleFrame: "",
    question: "What should this mean?",
    options: [
      { label: "Escape hatch", detail: "Music is the way out.", response: "Music is her escape hatch." },
      { label: "Public self", detail: "Music exposes the version of her the world cannot own.", response: "Music is her public self." },
    ],
    lockCandidate: null,
    risks: [],
  }, discovery.turnPlan);

  assert.deepEqual(actions, []);

  const requestedTurnPlan = {
    ...discovery.turnPlan,
    questionMode: "requested_options",
    allowModelOptions: true,
  };
  const requestedActions = specialistOptionsToActions({
    specialist: "plot_lab_character_analyst",
    status: "needs_input",
    objective: "",
    lockedContextUsed: [],
    evidenceUsed: [],
    recommendedMove: "show_options",
    visibleFrame: "",
    question: "What should this mean?",
    options: [
      { label: "Escape hatch", detail: "Music is the way out.", response: "Music is her escape hatch." },
      { label: "Public self", detail: "Music exposes the version of her the world cannot own.", response: "Music is her public self." },
    ],
    lockCandidate: null,
    risks: [],
  }, requestedTurnPlan);

  assert.deepEqual(requestedActions.map((action) => action.kind), ["requested_option", "requested_option"]);
  assert.deepEqual(requestedActions.map((action) => action.label), ["Escape hatch", "Public self"]);

  const openingActions = specialistOptionsToActions({
    specialist: "plot_lab_source_soul_scan",
    status: "needs_input",
    objective: "",
    lockedContextUsed: [],
    evidenceUsed: [],
    recommendedMove: "show_options",
    visibleFrame: "",
    question: "Is this right?",
    options: [{ label: "Should not show", detail: "Opening is fixed." }],
    lockCandidate: null,
    risks: [],
  }, createInitialPlotLabControllerState().turnPlan);
  assert.deepEqual(openingActions, []);
}

function testRequestedOptions() {
  const state = {
    ...createInitialPlotLabControllerState(),
    phase: "monetization_discovery",
    focusId: "plot",
    focusIndex: 4,
    assistantTurnKind: "monetization_bridge",
    questionVector: "monetization_endpoint",
    questionMode: "typed",
  };

  const requested = planPlotLabAssistantTurn(state, "Give me monetization options");

  assert.equal(requested.phase, "monetization_discovery");
  assert.equal(requested.turnPlan.questionMode, "requested_options");
  assert.equal(requested.turnPlan.allowModelOptions, true);
  assert.deepEqual(requested.turnPlan.actions.map((action) => action.kind), ["reroll_options", "custom_answer"]);
}

function testAnswerQualityClassification() {
  const opening = createInitialPlotLabControllerState();
  const discovery = planPlotLabAssistantTurn(opening, "Yes, this is right");

  assert.equal(classifyPlotLabUserIntent("therapy", discovery), "quality_feedback");
  assert.equal(classifyPlotLabUserIntent("Whatever", discovery), "low_signal");
  assert.equal(classifyPlotLabUserIntent("yes", discovery), "low_signal");
  assert.equal(classifyPlotLabUserIntent("go aehad", discovery), "low_signal");
  assert.equal(classifyPlotLabUserIntent("Nice question. Rival gang war", discovery), "normal");

  const summary = {
    ...discovery,
    waitingFor: "approve_lock",
    questionMode: "fixed_actions",
    assistantTurnKind: "checkpoint_summary",
  };
  assert.equal(classifyPlotLabUserIntent("yes", summary), "lock_current");
  assert.equal(classifyPlotLabUserIntent("go ahead", summary), "lock_current");
}

function testLowSignalAndFeedbackDoNotAdvanceQuestionCount() {
  const discovery = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right");

  const lowSignalTurn = planPlotLabAssistantTurn(discovery, "Whatever");
  assert.equal(lowSignalTurn.lastUserIntent, "low_signal");
  assert.equal(commitPlotLabAssistantTurn(lowSignalTurn).questionsInFocus, lowSignalTurn.questionsInFocus);

  const feedbackTurn = planPlotLabAssistantTurn(discovery, "therapy");
  assert.equal(feedbackTurn.lastUserIntent, "quality_feedback");
  assert.equal(commitPlotLabAssistantTurn(feedbackTurn).questionsInFocus, feedbackTurn.questionsInFocus);
}

function testDistinctStage1Vectors() {
  const protagonistQ1 = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right");
  assert.equal(protagonistQ1.questionVector, "character_anchor");
  assert.equal(protagonistQ1.frameworkSlot, "screen_promise");

  const protagonistQ1Committed = commitPlotLabAssistantTurn(protagonistQ1);
  const protagonistQ2 = planPlotLabAssistantTurn(protagonistQ1Committed, "Her joy in music");
  assert.equal(protagonistQ2.questionVector, "spark_in_world");
  assert.equal(protagonistQ2.frameworkSlot, "world_effect");

  const primaryQ1 = planPlotLabAssistantTurn({
    ...protagonistQ1,
    phase: "character_discovery",
    focusId: "primary_counterpart",
    focusIndex: 1,
    questionsInFocus: 0,
  }, "next");
  assert.equal(primaryQ1.questionVector, "relationship_function");
  assert.equal(primaryQ1.frameworkSlot, "relationship_conversion");

  const primaryQ2 = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(primaryQ1), "Hiro draws attention");
  assert.equal(primaryQ2.questionVector, "choice_space");
  assert.equal(primaryQ2.frameworkSlot, "new_door_new_cost");

  const operatorQ1 = planPlotLabAssistantTurn({
    ...protagonistQ1,
    phase: "character_discovery",
    focusId: "operator_pressure",
    focusIndex: 2,
    questionsInFocus: 0,
  }, "next");
  assert.equal(operatorQ1.questionVector, "power_language");
  assert.equal(operatorQ1.frameworkSlot, "pressure_style");

  const operatorQ2 = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(operatorQ1), "Ming is polite pressure");
  assert.equal(operatorQ2.questionVector, "world_rule");
  assert.equal(operatorQ2.frameworkSlot, "power_rule");
}

function testFrameworkSlotsDriveRelationshipMonetizationAndBridge() {
  const base = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right");
  const relationshipQ1 = planPlotLabAssistantTurn({
    ...base,
    phase: "relationship_discovery",
    focusId: "relationship_core",
    focusIndex: 3,
    questionsInFocus: 0,
  }, "next");
  assert.equal(relationshipQ1.questionVector, "world_pressure");
  assert.equal(relationshipQ1.frameworkSlot, "arena");

  const relationshipQ2 = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(relationshipQ1), "Casino as public empire");
  assert.equal(relationshipQ2.questionVector, "unresolved_ecology");
  assert.equal(relationshipQ2.frameworkSlot, "engine_secret");

  const monetizationGate = {
    ...createInitialPlotLabControllerState(),
    phase: "plot_transition_gate",
    focusId: "plot",
    focusIndex: 4,
    assistantTurnKind: "character_board_summary",
    questionVector: "lock_review",
    questionMode: "fixed_actions",
  };
  const monetization = planPlotLabAssistantTurn(monetizationGate, "Move into plot");
  assert.equal(monetization.frameworkSlot, "paid_image");

  const premiseDiscovery = planPlotLabAssistantTurn({
    ...monetization,
    phase: "monetization_lock_review",
    assistantTurnKind: "monetization_review",
    questionVector: "lock_review",
    questionMode: "fixed_actions",
    waitingFor: "approve_lock",
  }, "Lock this");
  assert.equal(premiseDiscovery.phase, "premise_bridge");
  assert.equal(premiseDiscovery.frameworkSlot, "earned_change");
  assert.equal(premiseDiscovery.turnPlan.allowModelOptions, false);
  assert.deepEqual(premiseDiscovery.turnPlan.actions.map((action) => action.kind), ["custom_answer"]);

  const premiseReview = planPlotLabAssistantTurn(premiseDiscovery, "Vincent's empire shows cracks");
  assert.equal(premiseReview.phase, "premise_bridge");
  assert.equal(premiseReview.frameworkSlot, "lock_review");
  assert.equal(premiseReview.turnPlan.allowModelOptions, false);
  assert.deepEqual(premiseReview.turnPlan.actions.map((action) => action.kind), ["lock_current", "revise_current", "reroll_options", "custom_answer"]);
  assert.equal(premiseReview.allowedNextMove.startsWith("Restate the universe/premise bridge candidate"), true);
}

function testStage1TypedQuestionsAreAudited() {
  const discovery = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right");
  assert.equal(selectPlotLabSpecialist(discovery).auditAfter, true);

  const opening = createInitialPlotLabControllerState();
  assert.equal(selectPlotLabSpecialist(opening).auditAfter, false);
}

function testStage1CompleteIsTerminal() {
  const premiseBridge = {
    ...createInitialPlotLabControllerState(),
    phase: "premise_bridge",
    focusId: "plot",
    focusIndex: 4,
    assistantTurnKind: "premise_bridge",
    questionVector: "monetization_delta",
    questionMode: "fixed_actions",
  };
  const complete = planPlotLabAssistantTurn(premiseBridge, "Lock this");
  assert.equal(complete.phase, "stage_1_complete");
  assert.equal(complete.waitingFor, "idle");
  assert.deepEqual(complete.turnPlan.actions, []);

  const afterExtraInput = planPlotLabAssistantTurn(complete, "now build episode 2");
  assert.equal(afterExtraInput.phase, "stage_1_complete");
  assert.equal(afterExtraInput.assistantTurnKind, "stage_1_complete");
  assert.equal(afterExtraInput.waitingFor, "idle");
  assert.deepEqual(afterExtraInput.turnPlan.actions, []);
}

async function testPrivateReleaseGateStaticWiring() {
  const schema = await readFile(new URL("../src/lib/db/schema.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
  const usersRoute = await readFile(new URL("../src/app/api/admin/users/[id]/route.ts", import.meta.url), "utf8");
  const aiRoute = await readFile(new URL("../src/app/api/ai/edit/route.ts", import.meta.url), "utf8");
  const access = await readFile(new URL("../src/lib/plot-lab/access.ts", import.meta.url), "utf8");
  const documentPage = await readFile(new URL("../src/app/doc/[id]/page.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src/components/ai/AIChatSidebar.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/components/labs/PlotLabWorkspace.tsx", import.meta.url), "utf8");

  assert.equal(schema.includes("plotLabAccess"), true);
  assert.equal(auth.includes("session.user.plotLabAccess"), true);
  assert.equal(adminPage.includes("Enable Plot Lab"), true);
  assert.equal(usersRoute.includes("plotLabAccess"), true);
  assert.equal(aiRoute.includes("getPlotLabAccess"), true);
  assert.equal(aiRoute.includes("isPlotLabStage2Mode"), true);
  assert.equal(access.includes("PLOT_LAB_PRIVATE_RELEASE_ENABLED"), true);
  assert.equal(access.includes("PLOT_LAB_STAGE2_ENABLED"), true);
  assert.equal(access.includes("document_forbidden"), true);
  assert.equal(documentPage.includes("/api/plot-lab/access"), true);
  assert.equal(documentPage.includes("canUsePlotLab={plotLabAccess.canUsePlotLab}"), true);
  assert.equal(sidebar.includes("canUsePlotLab"), true);
  assert.equal(workspace.includes("Start over"), true);
  assert.equal(workspace.includes("canUseTesterTools"), true);
  assert.equal(workspace.includes("!isUser && canUseTestingTools"), true);
  assert.equal(workspace.includes("contextSnapshot"), true);
  assert.equal(workspace.includes("runtimeInput"), true);
  assert.equal(workspace.includes("contextBlock"), true);
  assert.equal(workspace.includes("plotLabDecisions"), true);
  assert.equal(workspace.includes("priorUserMessage?.meta?.contextSnapshot"), true);
  assert.equal(workspace.includes("saveDecisionLock(assistantText, assistantMeta, plannedControllerState)"), true);
  assert.equal(workspace.includes("stripVisibleQuestions(assistantText)"), true);
  assert.equal(workspace.includes("function isLockReviewTurn"), true);
  assert.equal(workspace.includes("isDeterministicReviewTurn(plannedControllerState)"), true);
  assert.equal(workspace.includes("renderReviewAssistantText(specialistBrief)"), true);
  assert.equal(workspace.includes("frameworkSlot"), true);
  assert.equal(workspace.includes("plotLabDecisionsContentRef.current"), true);
  assert.equal(workspace.includes("plotLabDecisions: plotLabDecisionsTagged"), true);
  assert.equal(workspace.includes("activeTabLiveContent = activeTab.type === \"plot_lab_decisions\""), true);
}

async function testNoProseChoiceParser() {
  const workspace = await readFile(new URL("../src/components/labs/PlotLabWorkspace.tsx", import.meta.url), "utf8");
  const controller = await readFile(new URL("../src/lib/plot-lab/controller.ts", import.meta.url), "utf8");
  const orchestration = await readFile(new URL("../src/lib/plot-lab/orchestration.ts", import.meta.url), "utf8");

  assert.equal(workspace.includes(`parseLevi${"Choices"}`), false);
  assert.equal(workspace.includes(`prepareVisible${"Choices"}`), false);
  assert.equal(workspace.includes(`choice.${"key"}`), false);
  assert.equal(`${controller}\n${orchestration}`.includes(`story_${"choices"}`), false);
  assert.equal(`${controller}\n${orchestration}`.includes(`button${"Policy"}`), false);
  assert.equal(workspace.includes("controllerSnapshot"), true);
  assert.equal(workspace.includes("turnPlan"), true);
}

testOpeningActions();
testTypedDiscovery();
testStage1DiscoveryOptionsAcrossPipeline();
testStructuredOptionsBecomeActions();
testRequestedOptions();
testAnswerQualityClassification();
testLowSignalAndFeedbackDoNotAdvanceQuestionCount();
testDistinctStage1Vectors();
testFrameworkSlotsDriveRelationshipMonetizationAndBridge();
testStage1TypedQuestionsAreAudited();
testStage1CompleteIsTerminal();
await testNoProseChoiceParser();
await testPrivateReleaseGateStaticWiring();

console.log("Plot Lab regression checks passed");
