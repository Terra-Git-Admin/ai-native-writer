import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertPitchLabIdeaSeedText,
} from "../src/lib/ai/pitch-lab-idea-seed-format.ts";
import { buildMinimalFreshIdeaPrompt, buildMinimalFreshIdeaBatchRegenerationPrompt, parseMinimalIdeaLines, pickMinimalIdeaHeading } from "../src/lib/ai/pitch-lab-minimal-ideas.ts";
import {
  assertPitchLabPilotOptionText,
  parsePitchLabPilotOptionText,
  validatePitchLabPilotOptionBatch,
} from "../src/lib/ai/pitch-lab-pilot-option-format.ts";
import {
  assertPitchLabPilotPlotText,
} from "../src/lib/ai/pitch-lab-pilot-plot-format.ts";
import { assertPitchLabEpisodePilotText, parsePitchLabEpisodePilots } from "../src/lib/ai/pitch-lab-episode-pilot.ts";
import {
  serializePitchIdeaEnvelope,
  parsePitchIdeaEnvelope,
} from "../src/lib/pitch-lab-idea-envelope.ts";
import {
  buildPitchLabSampleIdeas,
  buildPitchLabSamplePremises,
} from "../src/lib/ai/pitch-lab-samples.ts";
import {
  compilePitchLabInstructions,
} from "../src/lib/ai/pitch-lab-instruction-compiler.ts";
import {
  buildPitchLabPilotBatchPrompt,
  buildPitchLabPremisePrompt,
  buildPitchLabRefinementPrompt,
  buildPitchLabEpisodePilotPrompt,
  buildPitchLabEpisodePilotSystemPrompt,
  buildPitchLabEpisodeRefinementPrompt,
  buildPitchLabEpisodeRefinementSystemPrompt,
  PITCH_LAB_SHORTLIST_PROMPT_VERSION,
} from "../src/lib/ai/pitch-lab-prompts.ts";

function testPilotOptionContract() {
  const text = [
    "Hook: FL nurse saves ML mobster during a hospital lockdown",
    "Escalation: His enemies blame her and force them into a fake live-in contract",
    "Cliffhanger: She finds his blood type matches her missing brother",
  ].join("\n");

  assert.deepEqual(parsePitchLabPilotOptionText(text), {
    Hook: "FL nurse saves ML mobster during a hospital lockdown",
    Escalation: "His enemies blame her and force them into a fake live-in contract",
    Cliffhanger: "She finds his blood type matches her missing brother",
  });
  assert.equal(assertPitchLabPilotOptionText(text), text);
}

function testEpisodePilotContract() {
  const pilotPrompt = buildPitchLabEpisodePilotPrompt({ selectedPremise: "A masked surgeon saves the director's brother.", brief: "secret identity", instruction: "" });
  assert.match(pilotPrompt, /six short bullet points/);
  assert.match(pilotPrompt, /Do not use timestamps/);
  assert.match(buildPitchLabEpisodePilotSystemPrompt(), /engine of the conflict early/);
  const shortlistPrompt = buildPitchLabEpisodeRefinementPrompt({ premise: "Elena is a prosecutor posing as an intern.", current: "Elena plants a bug. Julian catches her.", instruction: "Connect the events." });
  assert.equal(PITCH_LAB_SHORTLIST_PROMPT_VERSION, "1.1");
  assert.match(shortlistPrompt, /Current Episode 1 plot: Elena plants a bug\. Julian catches her\./);
  assert.match(shortlistPrompt, /Writer instruction: Connect the events\./);
  assert.doesNotMatch(shortlistPrompt, /Original pilot:|Writer brief:/);
  assert.match(buildPitchLabEpisodeRefinementSystemPrompt(), /filling only missing causes and character reactions/);
  const output = Array.from({ length: 4 }, (_, index) => `---PILOT OPTION ${index + 1}---\nTitle: Hidden Ring\nShe hides in his hotel kitchen. He notices her ring and blocks the exit.`).join("\n");
  const options = parsePitchLabEpisodePilots(output);
  assert.equal(options.length, 4);
  assert.equal(options[0].title, "Hidden Ring");
  assert.equal(assertPitchLabEpisodePilotText(options[0].ideaText), options[0].ideaText);
  assert.equal(parsePitchLabEpisodePilots(output.replace("OPTION 4", "OPTION 3")).length, 4);
  assert.throws(() => parsePitchLabEpisodePilots(output.replace("---PILOT OPTION 4---", "")), /expected 4/);
  const envelope = parsePitchIdeaEnvelope(serializePitchIdeaEnvelope({
    originalText: options[0].ideaText,
    currentText: options[0].ideaText,
    contentKind: "episode_pilot",
    generation: { provider: "google", model: "gemini-3.1-pro-preview", pipeline: "single-call-episode-pilot", promptVersion: "2.37", thinkingLevel: "high" },
    turns: [{ instruction: "Tighten the reveal", ideaText: options[0].ideaText, createdAt: "2026-10-15T00:00:00Z", kind: "rewrite", contentKind: "episode_pilot", feedback: { rating: "down", reason: "Weak reveal", updatedAt: "2026-10-15T00:01:00Z" } }],
  }));
  assert.equal(envelope.contentKind, "episode_pilot");
  assert.equal(envelope.generation?.model, "gemini-3.1-pro-preview");
  assert.equal(envelope.turns[0].feedback?.reason, "Weak reveal");
}

function testIdeaSeedContract() {
  const seed = "FL nurse saves ML mobster's life and is offered a live-in contract.";
  assert.equal(assertPitchLabIdeaSeedText(seed), seed);
  assert.equal(
    assertPitchLabIdeaSeedText("FL designer meets ML billionaire and must navigate secrets together."),
    "FL designer meets ML billionaire and must navigate secrets together."
  );

  assert.equal(assertPitchLabIdeaSeedText("A broke medical resident signs a one-year marriage contract with a disfigured chaebol heir to fund her mother's surgery."), "A broke medical resident signs a one-year marriage contract with a disfigured chaebol heir to fund her mother's surgery.");
  assert.throws(() => assertPitchLabIdeaSeedText("   "), /cannot be empty/);
  assert.equal(
    assertPitchLabIdeaSeedText("FL medical resident signs ML heir's marriage contract to fund surgery--then treats the accident meant to erase him."),
    "FL medical resident signs ML heir's marriage contract to fund surgery--then treats the accident meant to erase him."
  );
  assert.equal(
    assertPitchLabIdeaSeedText("FL nurse saves ML mobster's life and the season follows their contract romance across dangerous episodes"),
    "FL nurse saves ML mobster's life and the season follows their contract romance across dangerous episodes"
  );
}

function testMinimalIdeaExperiment() {
  const prompt = buildMinimalFreshIdeaPrompt("secret identity", "Give me 10 single line ideas for Pilot Episode 1");
  assert.match(prompt, /one-line ideas for possible Episode 1 microdrama plots/);
  assert.match(prompt, /each lead's gender clear through names or gendered words/);
  assert.match(prompt, /secret identity/);
  assert.match(prompt, /Give me 10 single line ideas for Pilot Episode 1/);
  assert.doesNotMatch(prompt, /premiseText|start with FL|8-28 words|Taste Brief|JSON/);
  const regenerationPrompt = buildMinimalFreshIdeaBatchRegenerationPrompt(
    "secret identity",
    "Make these ideas darker, with no wedding setup.",
    ["A surgeon hides her identity.", "An heiress takes a clerk job."],
  );
  assert.ok(regenerationPrompt.startsWith(prompt.replace("Give me 10 single line ideas for Pilot Episode 1", "Make these ideas darker, with no wedding setup.")));
  assert.match(regenerationPrompt, /Replace the current set with a new set/);
  assert.match(regenerationPrompt, /Make these ideas darker, with no wedding setup/);
  assert.match(regenerationPrompt, /1\. A surgeon hides her identity/);
  assert.match(regenerationPrompt, /otherwise return 2 ideas/);
  assert.doesNotMatch(regenerationPrompt, /premiseText|start with FL|8-28 words|Taste Brief/);
  const ideas = parseMinimalIdeaLines("1. A surgeon hides her identity.\n2. The heiress takes a clerk job.\n");
  assert.deepEqual(ideas, ["A surgeon hides her identity.", "The heiress takes a clerk job."]);
  assert.equal(pickMinimalIdeaHeading("To survive a scandal, an exiled heiress disguises herself as a paralegal."), "Heiress");
  assert.equal(pickMinimalIdeaHeading("A disgraced surgeon secretly works as a street medic."), "Surgeon");
  assert.equal(pickMinimalIdeaHeading("Forced to pretend to be her dead twin brother, she enters a boardroom showdown."), "Twin");
  assert.equal(pickMinimalIdeaHeading("A violinist blackmails the owner."), "Violinist");
}

function testPilotOptionRejections() {
  assert.throws(
    () => assertPitchLabPilotOptionText("A summary paragraph about the whole story."),
    /Hook, Escalation, and Cliffhanger/
  );
}

function testPilotOptionBatchAcceptsModelOutput() {
  const options = [
    "Hook: FL nurse saves ML mobster during a hospital lockdown\nEscalation: His enemies blame her and force them into a fake live-in contract\nCliffhanger: She finds his blood type matches her missing brother",
    "Hook: FL court clerk catches ML lawyer hiding evidence inside the courthouse archive\nEscalation: The judge frames her as the leak while he needs her badge to reopen testimony\nCliffhanger: She names his brother on the courthouse livestream",
    "Hook: FL banquet singer records ML heir's mother bribing a witness at an engagement hall\nEscalation: His family brands her an extortionist before every guest\nCliffhanger: He calls her his secret wife as security closes in",
    "Hook: FL taxi dispatcher hears ML CEO's panic code through the night depot radio\nEscalation: A bounty appears under her company account and every driver cancels\nCliffhanger: He arrives bleeding and asks her to dispatch herself as his fiancee",
  ];
  assert.deepEqual(validatePitchLabPilotOptionBatch(options), []);

  const weakButStructured = [
    "Hook: FL nurse saves ML mobster during a hospital lockdown\nEscalation: His enemies blame her and force them into a fake live-in contract\nCliffhanger: She finds his blood type matches her missing brother",
    "Hook: FL doctor saves ML gangster during a hospital lockdown\nEscalation: His enemies blame her and force them into a fake live-in contract\nCliffhanger: She finds his blood type matches her missing brother",
    "Hook: FL medic saves ML heir during a hospital lockdown\nEscalation: His enemies blame her and force them into a fake live-in contract\nCliffhanger: She finds his blood type matches her missing brother",
    "Hook: FL surgeon saves ML boss during a hospital lockdown\nEscalation: His enemies blame her and force them into a fake live-in contract\nCliffhanger: She finds his blood type matches her missing brother",
  ];
  assert.deepEqual(validatePitchLabPilotOptionBatch(weakButStructured), []);
}

function testPilotPlotContractAndContentKind() {
  const plot = [
    "Opening: FL nurse hides ML mobster in a closed hospital wing after saving his life during a blackout",
    "Plot progression: His enemies frame her as the accomplice, and his live-in contract becomes the only way to protect her license",
    "Final cliffhanger: She signs the contract, then sees her missing brother's ring on ML's enemy",
  ].join("\n");
  assert.equal(assertPitchLabPilotPlotText(plot), plot);

  const longButStructuredPlot = [
    "Opening: FL nurse hides ML mobster in a closed hospital wing after saving his life during a blackout",
    "Plot progression: His enemies frame her as the accomplice, his family leaks edited security footage, the hospital board suspends her, the police arrive with questions, and the live-in contract becomes the only immediate way to keep her license, protect the ward, and force ML to expose who ordered the hit before morning rounds begin",
    "Final cliffhanger: She signs the contract, then sees her missing brother's ring on ML's enemy",
  ].join("\n");
  assert.equal(assertPitchLabPilotPlotText(longButStructuredPlot), longButStructuredPlot);

  const optionEnvelope = serializePitchIdeaEnvelope({
    originalText: "Hook: FL nurse saves ML mobster during a hospital lockdown\nEscalation: His enemies blame her and force them into a fake live-in contract\nCliffhanger: She finds his blood type matches her missing brother",
    currentText: "Hook: FL nurse saves ML mobster during a hospital lockdown\nEscalation: His enemies blame her and force them into a fake live-in contract\nCliffhanger: She finds his blood type matches her missing brother",
    contentKind: "pilot_option",
    turns: [],
    writerContext: {
      workspaceBrief: "secret identity",
      latestInstruction: "rainy hospital",
      selectedIdea: "FL nurse saves ML mobster's life and is offered a live-in contract.",
      selectedPilotOption: "Hook: FL nurse saves ML mobster during a hospital lockdown\nEscalation: His enemies blame her\nCliffhanger: He offers a live-in contract",
      carriedNotes: "keep the cover role visible",
    },
  });
  const plotEnvelope = serializePitchIdeaEnvelope({
    originalText: plot,
    currentText: plot,
    contentKind: "pilot_plot",
    turns: [],
  });
  assert.equal(parsePitchIdeaEnvelope(optionEnvelope).contentKind, "pilot_option");
  assert.equal(parsePitchIdeaEnvelope(plotEnvelope).contentKind, "pilot_plot");
  assert.equal(assertPitchLabPilotPlotText(parsePitchIdeaEnvelope(plotEnvelope).currentText), plot);
  assert.deepEqual(parsePitchIdeaEnvelope(optionEnvelope).writerContext, {
    workspaceBrief: "secret identity",
    latestInstruction: "rainy hospital",
    selectedIdea: "FL nurse saves ML mobster's life and is offered a live-in contract.",
    selectedPilotOption: "Hook: FL nurse saves ML mobster during a hospital lockdown\nEscalation: His enemies blame her\nCliffhanger: He offers a live-in contract",
    carriedNotes: "keep the cover role visible",
  });
}

function testInstructionCompilerUsesPhraseBoundaries() {
  const controls = compilePitchLabInstructions({
    stage: "pilot_options",
    brief: "secret identity",
    selectedIdea: "FL undercover cop saves ML scandal-prone actor and becomes his live-in bodyguard to bait a kingpin.",
    carriedContext: "Management installs her as guard.",
    generationType: "framework",
  });

  assert.ok(!controls.roleCues.includes("king"), "kingpin must not trigger king");
  assert.ok(!controls.roleCues.includes("mage"), "management must not trigger mage");
  assert.ok(controls.roleCues.includes("guard"));
  assert.ok(controls.evidence.includes("undercover"));
}

function testWriterContextReachesAllPromptStages() {
  const writerContext = [
    "WRITER CONTEXT - CARRY THIS THROUGH",
    "- Original writer brief: secret identity",
    "- Latest writer instruction: rainy hospital",
    "- Selected Idea: FL nurse saves ML mobster's life and is offered a live-in contract.",
    "- Selected Pilot Option: Hook: FL hides him in ICU",
    "- Carried notes: jealous ex",
  ].join("\n");

  const premisePrompt = buildPitchLabPremisePrompt({
    generationType: "framework",
    adaptationStyle: "loose",
    brief: "secret identity",
    instruction: "no mafia",
    sourceMaterial: "",
    instructionControls: "",
    writerContext,
  });
  const pilotPrompt = buildPitchLabPilotBatchPrompt({
    generationType: "framework",
    adaptationStyle: "loose",
    brief: "secret identity",
    instruction: "jealous ex",
    sourceMaterial: "",
    selectedPremise: "FL nurse saves ML mobster's life and is offered a live-in contract.",
    instructionControls: "",
    writerContext,
  });
  const plotPrompt = buildPitchLabRefinementPrompt({
    currentTitle: "ICU",
    currentText: "Hook: FL hides him in ICU\nEscalation: His rival arrives\nCliffhanger: ML offers a live-in contract",
    originalText: "Hook: FL hides him in ICU\nEscalation: His rival arrives\nCliffhanger: ML offers a live-in contract",
    priorTurns: "None.",
    instruction: "make the hospital rainy",
    premise: "FL nurse saves ML mobster's life and is offered a live-in contract.",
    writerContext,
  });

  for (const prompt of [premisePrompt, pilotPrompt, plotPrompt]) {
    assert.ok(prompt.includes("WRITER CONTEXT - CARRY THIS THROUGH"));
    assert.ok(prompt.includes("secret identity"));
    assert.ok(prompt.includes("rainy hospital"));
    assert.ok(prompt.includes("jealous ex"));
  }
}

function testSamplesMatchContract() {
  const premises = buildPitchLabSamplePremises({
    generationType: "framework",
    adaptationStyle: "loose",
    sourceTitle: "Sample",
  });
  assert.equal(premises.length, 8);
  assert.ok(premises.every((premise) => premise.premiseText.split(/\s+/).length <= 35));
  premises.forEach((premise) => assertPitchLabIdeaSeedText(premise.premiseText));

  const options = buildPitchLabSampleIdeas({
    generationType: "framework",
    adaptationStyle: "loose",
    sourceTitle: "Sample",
    selectedPremise: "FL nurse saves ML mobster's life and is offered a live-in contract.",
  });
  assert.equal(options.length, 4);
  options.forEach((option) => assertPitchLabPilotOptionText(option.ideaText));
  options.forEach((option) => {
    const words = option.ideaText.split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 40, `Sample Pilot Option should stay compact: ${option.ideaText}`);
  });
}

function testPilotOptionPromptStaysSimple() {
  const promptSource = fs.readFileSync("src/lib/ai/pitch-lab-prompts.ts", "utf8");
  const pilotOptionPromptSource = promptSource.split("export function buildPitchLabRefinementSystemPrompt")[0];
  assert.ok(pilotOptionPromptSource.includes("create four simple pilot directions"));
  assert.ok(pilotOptionPromptSource.includes("Aim for 18-35 words total per Pilot Option"));
  assert.ok(pilotOptionPromptSource.includes("vary the hook type, escalation type, and cliffhanger type"));
  assert.ok(pilotOptionPromptSource.includes("ML late arrival"));
  assert.ok(pilotOptionPromptSource.includes("WRITER CONTEXT CARRY-FORWARD"));
  assert.ok(!pilotOptionPromptSource.includes('"kernel":"hidden concise option thesis"'));
  assert.ok(!pilotOptionPromptSource.includes('"beats":"hidden pilot construct map'));
  assert.ok(!pilotOptionPromptSource.includes('"clarityChecks":"hidden QA summary'));
}

function testPilotPlotPromptStaysSimple() {
  const promptSource = fs.readFileSync("src/lib/ai/pitch-lab-prompts.ts", "utf8");
  const pilotPlotPromptSource = promptSource.split("export function buildPitchLabRefinementSystemPrompt")[1];
  assert.ok(promptSource.includes("PILOT PLOT SIMPLICITY GATE"));
  assert.ok(promptSource.includes("Aim for 45-75 words total"));
  assert.ok(promptSource.includes("Opening: one setup image"));
  assert.ok(promptSource.includes("Plot progression: one main turn"));
  assert.ok(promptSource.includes("Final cliffhanger: one next-action turn"));
  assert.ok(pilotPlotPromptSource.includes("${PILOT_PLOT_SIMPLICITY_GATE}"));
  assert.ok(!pilotPlotPromptSource.includes("CONCRETE PILOT PLOT PROCESS"));
}

function testPilotOptionCardsAreNotCollapsed() {
  const uiSource = fs.readFileSync("src/components/pitch-lab/PitchLabStudioPage.tsx", "utf8");
  assert.ok(!uiSource.includes("expandedPilotIds"));
  assert.ok(!uiSource.includes("togglePilotExpanded"));
  assert.ok(!uiSource.includes("View more"));
  assert.ok(!uiSource.includes("[-webkit-line-clamp:2]"));
}

testPilotOptionContract();
testEpisodePilotContract();
testIdeaSeedContract();
testMinimalIdeaExperiment();
testPilotOptionRejections();
testPilotOptionBatchAcceptsModelOutput();
testPilotPlotContractAndContentKind();
testInstructionCompilerUsesPhraseBoundaries();
testWriterContextReachesAllPromptStages();
testSamplesMatchContract();
testPilotOptionPromptStaysSimple();
testPilotPlotPromptStaysSimple();
testPilotOptionCardsAreNotCollapsed();

console.log("Pitch Lab regression tests passed.");
