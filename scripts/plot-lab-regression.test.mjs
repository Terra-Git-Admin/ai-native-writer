import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyPlotLabUserIntent,
  commitPlotLabAssistantTurn,
  createInitialPlotLabControllerState,
  planPlotLabAssistantTurn,
} from "../src/lib/plot-lab/controller.ts";
import { selectPlotLabSpecialist, specialistOptionsToActions } from "../src/lib/plot-lab/orchestration.ts";

const TWO_CHARACTER_SOURCE_SCAN = {
  stage1CharacterBoard: [
    {
      label: "Asha",
      storyTerm: "Protagonist",
      disposition: "focus_question",
      rationale: "EP1 centers her visible choice.",
    },
    {
      label: "Rival police officer",
      storyTerm: "Antagonist",
      disposition: "focus_question",
      rationale: "EP1 makes this person the clearest opposition.",
    },
    {
      label: "Police department",
      storyTerm: "Obstacle",
      disposition: "summary_only",
      rationale: "World context, not a separate character pass.",
    },
  ],
};

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
  const discovery = planPlotLabAssistantTurn(opening, "Yes, this is right", TWO_CHARACTER_SOURCE_SCAN);

  assert.equal(discovery.phase, "protagonist_discovery");
  assert.equal(discovery.currentFocus, "Protagonist");
  assert.equal(discovery.turnPlan.questionMode, "typed");
  assert.equal(discovery.turnPlan.allowModelOptions, true);
  assert.deepEqual(discovery.turnPlan.actions.map((action) => action.kind), ["custom_answer"]);
}

function testStage1DiscoveryOptionsAcrossPipeline() {
  const protagonistQ1 = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right", TWO_CHARACTER_SOURCE_SCAN);
  assert.equal(protagonistQ1.turnPlan.allowModelOptions, true);

  const protagonistAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(protagonistQ1), "Her joy in music");
  assert.equal(protagonistAddMore.assistantTurnKind, "add_more_check");
  assert.equal(protagonistAddMore.waitingFor, "add_more");
  assert.equal(protagonistAddMore.turnPlan.allowModelOptions, false);
  assert.deepEqual(protagonistAddMore.turnPlan.actions.map((action) => action.kind), ["add_more_no", "add_more_yes"]);

  const antagonistQ1 = planPlotLabAssistantTurn(protagonistAddMore, "No");
  assert.equal(antagonistQ1.phase, "character_discovery");
  assert.equal(antagonistQ1.currentFocus, "Antagonist: Rival police officer");
  assert.equal(antagonistQ1.turnPlan.allowModelOptions, true);

  const antagonistAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(antagonistQ1), "He blocks the case.");
  const relationshipQ1 = planPlotLabAssistantTurn(antagonistAddMore, "No");
  assert.equal(relationshipQ1.phase, "relationship_discovery");
  assert.equal(relationshipQ1.turnPlan.allowModelOptions, true);

  const relationshipAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(relationshipQ1), "They keep colliding in public.");
  const monetizationGate = planPlotLabAssistantTurn(relationshipAddMore, "No");
  assert.equal(monetizationGate.assistantTurnKind, "character_board_summary");
  assert.deepEqual(monetizationGate.turnPlan.actions.map((action) => `${action.kind}:${action.label}`), [
    "lock_current:Move to monetization",
    "add_missing_detail:Add missing detail",
  ]);

  const characterNoteCheck = planPlotLabAssistantTurn(monetizationGate, "Add missing detail");
  assert.equal(characterNoteCheck.assistantTurnKind, "add_more_check");
  assert.equal(characterNoteCheck.focusId, "plot");
  assert.equal(characterNoteCheck.lastUserIntent, "add_missing_detail");
  const backToGate = planPlotLabAssistantTurn(characterNoteCheck, [
    "The writer is adding a missing Stage 1 detail before monetization.",
    "Context:",
    "Ming should be tracked as the third pressure character.",
  ].join("\n\n"));
  assert.equal(backToGate.assistantTurnKind, "character_board_summary");

  const monetizationPlanned = planPlotLabAssistantTurn(monetizationGate, "Lock this");
  assert.equal(monetizationPlanned.turnPlan.allowModelOptions, true);
  assert.deepEqual(monetizationPlanned.turnPlan.actions.map((action) => `${action.kind}:${action.label}`), [
    "reroll_options:Reroll options",
    "custom_answer:Write my own answer",
  ]);

  const monetizationReview = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(monetizationPlanned), "A public betrayal.");
  assert.equal(monetizationReview.assistantTurnKind, "monetization_review");
  assert.equal(monetizationReview.turnPlan.allowModelOptions, false);
}

function testSourceLedCharacterCounts() {
  const oneCharacterScan = {
    stage1CharacterBoard: [
      { label: "Mira", storyTerm: "Protagonist", disposition: "focus_question" },
      { label: "Debt", storyTerm: "Obstacle", disposition: "summary_only" },
    ],
  };
  const oneStart = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right", oneCharacterScan);
  assert.deepEqual(oneStart.stage1FocusPlan.map((focus) => focus.label), ["Protagonist", "Main Relationship"]);
  const oneAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(oneStart), "She wants freedom.");
  const oneRelationship = planPlotLabAssistantTurn(oneAddMore, "No");
  assert.equal(oneRelationship.focusId, "relationship_core");

  const underTaggedCounterpartScan = {
    stage1CharacterBoard: [
      { label: "Yuki", storyTerm: "Protagonist", disposition: "focus_question" },
      {
        label: "Hiro",
        storyTerm: "Character",
        disposition: "summary_only",
        rationale: "Primary romantic/status counterpart whose public claim changes Yuki's choices.",
      },
      {
        label: "Dad + sister",
        storyTerm: "Character",
        disposition: "summary_only",
        rationale: "Supportive family and home gravity.",
      },
      { label: "Hospital/police/media", storyTerm: "Obstacle", disposition: "summary_only" },
    ],
  };
  const counterpartStart = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right", underTaggedCounterpartScan);
  assert.deepEqual(counterpartStart.stage1FocusPlan.map((focus) => focus.label), ["Protagonist", "Hiro", "Main Relationship"]);
  const counterpartAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(counterpartStart), "Yuki keeps control.");
  const counterpartQuestion = planPlotLabAssistantTurn(counterpartAddMore, "No");
  assert.equal(counterpartQuestion.phase, "character_discovery");
  assert.equal(counterpartQuestion.currentFocus, "Hiro");

  const threeCharacterScan = {
    stage1CharacterBoard: [
      { label: "Mira", storyTerm: "Protagonist", disposition: "focus_question" },
      { label: "Dev", storyTerm: "Antagonist", disposition: "focus_question" },
      { label: "Auntie", storyTerm: "Character", disposition: "focus_question" },
    ],
  };
  const threeStart = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right", threeCharacterScan);
  assert.deepEqual(
    threeStart.stage1FocusPlan.map((focus) => focus.label),
    ["Protagonist", "Antagonist: Dev", "Auntie", "Main Relationship"]
  );
}

function testStructuredOptionsBecomeActions() {
  const discovery = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right", TWO_CHARACTER_SOURCE_SCAN);
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

  assert.deepEqual(actions.map((action) => action.kind), ["requested_option", "requested_option"]);
  assert.deepEqual(actions.map((action) => action.label), ["Escape hatch", "Public self"]);

  const repairedActions = specialistOptionsToActions({
    specialist: "plot_lab_character_analyst",
    status: "needs_input",
    objective: "",
    lockedContextUsed: [],
    evidenceUsed: [],
    recommendedMove: "show_options",
    visibleFrame: "",
    question: "What should this mean?",
    options: [],
    lockCandidate: null,
    risks: [],
  }, discovery.turnPlan);
  assert.deepEqual(repairedActions.map((action) => action.kind), ["requested_option", "requested_option"]);
  assert.equal(repairedActions.length, 2);

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
  assert.equal(classifyPlotLabUserIntent("No idea. figure it the fuck out. whats the point of you being here if i have to do everything.", discovery), "quality_feedback");
  assert.equal(classifyPlotLabUserIntent("Whatever", discovery), "low_signal");
  assert.equal(classifyPlotLabUserIntent("No idea", discovery), "low_signal");
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
  const protagonistQ1 = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right", TWO_CHARACTER_SOURCE_SCAN);
  assert.equal(protagonistQ1.questionVector, "character_anchor");
  assert.equal(protagonistQ1.frameworkSlot, "screen_promise");

  const protagonistQ1Committed = commitPlotLabAssistantTurn(protagonistQ1);
  const protagonistAddMore = planPlotLabAssistantTurn(protagonistQ1Committed, "Her joy in music");
  assert.equal(protagonistAddMore.assistantTurnKind, "add_more_check");
  assert.equal(protagonistAddMore.questionVector, "lock_review");
  assert.equal(protagonistAddMore.frameworkSlot, "lock_review");

  const antagonistQ1 = planPlotLabAssistantTurn(protagonistAddMore, "No");
  assert.equal(antagonistQ1.questionVector, "relationship_function");
  assert.equal(antagonistQ1.frameworkSlot, "relationship_conversion");

  const antagonistAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(antagonistQ1), "He blocks the case.");
  const relationshipQ1 = planPlotLabAssistantTurn(antagonistAddMore, "No");
  assert.equal(relationshipQ1.questionVector, "world_pressure");
  assert.equal(relationshipQ1.frameworkSlot, "arena");
}

function testFrameworkSlotsDriveRelationshipMonetizationAndBridge() {
  const base = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right", TWO_CHARACTER_SOURCE_SCAN);
  const protagonistAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(base), "Asha protects her clean future.");
  const antagonistQ1 = planPlotLabAssistantTurn(protagonistAddMore, "No");
  const antagonistAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(antagonistQ1), "The officer wants control.");
  const relationshipQ1 = planPlotLabAssistantTurn(antagonistAddMore, "No");
  assert.equal(relationshipQ1.questionVector, "world_pressure");
  assert.equal(relationshipQ1.frameworkSlot, "arena");

  const relationshipAddMore = planPlotLabAssistantTurn(commitPlotLabAssistantTurn(relationshipQ1), "Police pressure is public.");
  assert.equal(relationshipAddMore.assistantTurnKind, "add_more_check");

  const monetizationGate = planPlotLabAssistantTurn(relationshipAddMore, "No");
  const monetization = planPlotLabAssistantTurn(monetizationGate, "Lock this");
  assert.equal(monetization.frameworkSlot, "paid_image");

  const monetizationReview = planPlotLabAssistantTurn({
    ...monetization,
    phase: "monetization_lock_review",
    assistantTurnKind: "monetization_review",
    questionVector: "lock_review",
    questionMode: "fixed_actions",
    waitingFor: "approve_lock",
  }, "Lock this");
  assert.equal(monetizationReview.phase, "stage_1_complete");
  assert.equal(monetizationReview.frameworkSlot, "stage_1_complete");
  assert.equal(monetizationReview.turnPlan.allowModelOptions, false);
  assert.deepEqual(monetizationReview.turnPlan.actions, []);
}

function testStage1TypedQuestionsAreAudited() {
  const discovery = planPlotLabAssistantTurn(createInitialPlotLabControllerState(), "Yes, this is right");
  assert.equal(selectPlotLabSpecialist(discovery).auditAfter, true);

  const opening = createInitialPlotLabControllerState();
  assert.equal(selectPlotLabSpecialist(opening).auditAfter, false);
}

function testStage1CompleteIsTerminal() {
  const monetizationReview = {
    ...createInitialPlotLabControllerState(),
    phase: "monetization_lock_review",
    focusId: "plot",
    focusIndex: 2,
    assistantTurnKind: "monetization_review",
    questionVector: "lock_review",
    questionMode: "fixed_actions",
  };
  const complete = planPlotLabAssistantTurn(monetizationReview, "Lock this");
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

async function testPlotLabPromptReversionGuards() {
  const prompts = await readFile(new URL("../src/lib/ai/prompts.ts", import.meta.url), "utf8");
  const seedPrompts = await readFile(new URL("../src/lib/ai/seed-prompts.ts", import.meta.url), "utf8");
  const controller = await readFile(new URL("../src/lib/plot-lab/controller.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/components/labs/PlotLabWorkspace.tsx", import.meta.url), "utf8");

  const promptForbidden = [
    "Q2",
    "question 2",
    "two questions",
    "primary counterpart",
    "operator/pressure",
    "pressure face",
    "premise_bridge",
    "monetization delta",
    "world_effect",
    "new_door_new_cost",
    "power_rule",
    "engine_secret",
  ];
  for (const phrase of promptForbidden) {
    assert.equal(prompts.includes(phrase), false, `old Plot Lab prompt phrase survived: ${phrase}`);
  }

  assert.equal(seedPrompts.includes("plot_lab_premise_bridge"), false);
  assert.equal(controller.includes("secondQuestionVectorForFocus"), false);
  assert.equal(controller.includes("nextDiscoveryQuestionVector"), false);
  assert.equal(workspace.includes("Pressure/operator"), false);
  assert.equal(workspace.includes("Primary Counterpart"), false);
  assert.equal(controller.includes("label: \"Move into plot\""), false);
  assert.equal(controller.includes("label: \"Stay with character\""), false);
  assert.equal(controller.includes("label: \"Add character note\""), false);
  assert.equal(controller.includes("label: \"Add missing detail\""), true);
  assert.equal(workspace.includes("Anything important we missed before monetization?"), true);
  assert.equal(workspace.includes("visibleActions"), true);
  assert.equal(workspace.includes("if (state.phase === \"plot_transition_gate\") return \"Character Locks\";"), true);
  assert.equal(workspace.includes("return cleanAssistantText(brief.lockCandidate?.text?.trim() || brief.visibleFrame?.trim() || \"\");"), true);
}

testOpeningActions();
testTypedDiscovery();
testStage1DiscoveryOptionsAcrossPipeline();
testSourceLedCharacterCounts();
testStructuredOptionsBecomeActions();
testRequestedOptions();
testAnswerQualityClassification();
testLowSignalAndFeedbackDoNotAdvanceQuestionCount();
testDistinctStage1Vectors();
testFrameworkSlotsDriveRelationshipMonetizationAndBridge();
testStage1TypedQuestionsAreAudited();
testStage1CompleteIsTerminal();
await testNoProseChoiceParser();
await testPlotLabPromptReversionGuards();
await testPrivateReleaseGateStaticWiring();

console.log("Plot Lab regression checks passed");
