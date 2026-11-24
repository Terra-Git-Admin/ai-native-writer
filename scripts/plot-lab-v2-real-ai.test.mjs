import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/lib/plot-lab-v2/real-ai.ts", import.meta.url),
  "utf8"
);
const actionSource = await readFile(
  new URL("../src/lib/plot-lab-v2/action-service.ts", import.meta.url),
  "utf8"
);
const runnerSource = await readFile(
  new URL("../src/lib/plot-lab-v2/generation-runner.ts", import.meta.url),
  "utf8"
);
const workspaceSource = await readFile(
  new URL("../src/components/labs/PlotLabV2Workspace.tsx", import.meta.url),
  "utf8"
);
const promptSource = await readFile(
  new URL("../src/lib/plot-lab-v2/prompts.ts", import.meta.url),
  "utf8"
);
const referenceFixtureSource = await readFile(
  new URL("./plot-lab-v2-reference-fixtures.mjs", import.meta.url),
  "utf8"
);
const creativeSchemaSource = source.slice(
  source.indexOf("const creativeOutput"),
  source.indexOf("const connectedOutput")
);
const connectedSchemaSource = source.slice(
  source.indexOf("const connectedOutput"),
  source.indexOf("function configuredModelIds")
);
const purposeSchemaSource = source.slice(
  source.indexOf("function purposeMapOutput"),
  source.indexOf("const endpointOutput")
);
const purposeGenerationSource = source.slice(
  source.indexOf("export async function generatePurposeMap"),
  source.indexOf("export async function generateSourceTruth")
);

assert.match(
  source,
  /output:\s*connectedOutput/,
  "Connector generation must use the AI SDK structured-output contract."
);
assert.match(purposeSchemaSource, /minItems:\s*unitCount[\s\S]*?maxItems:\s*unitCount/, "Purpose output must use the exact app-owned unit count.");
assert.match(purposeSchemaSource, /required:\s*\["centralTransformation", "monetizationDelivery", "units"\]/, "Purpose planning must construct one batch-level transformation and exact monetization delivery.");
assert.match(purposeSchemaSource, /required:\s*\["title", "completeEvent", "meaningfulChange", "purposeLine"\]/, "Each purpose unit must carry only the minimal construction behind its writer-facing line.");
assert.doesNotMatch(purposeSchemaSource, /strategyOptions|dominantExperience|timePhase|locationFunction|storyCharacters|informationMove|relationshipMove|monetizationContribution|sourceAnchors/, "Purpose planning must not turn creative reasoning into a field-heavy form.");
assert.doesNotMatch(purposeSchemaSource, /incomingPressure|decisiveMove|stateDelta|outgoingHook|purposeUnitId/, "Purpose transport must keep app-owned lineage metadata out of model output.");
assert.doesNotMatch(purposeGenerationSource, /new Map\(result\.units|written\.number|purposeUnitId, unit/, "Approved plots must be matched by app-owned order, not model-generated IDs or numbers.");
assert.match(purposeGenerationSource, /centralTransformation[\s\S]*?monetizationDelivery/, "The Plot Writer must receive the batch-level construction direction.");
assert.match(purposeGenerationSource, /completeEvent[\s\S]*?meaningfulChange[\s\S]*?purposeLine/, "The Plot Writer must receive each complete episode event and changed state rather than only a purpose line.");
assert.match(purposeGenerationSource, /Some expanded plots repeat[\s\S]*?readable batch was preserved/, "Duplicate readable plots must warn instead of failing the entire batch.");
assert.match(
  creativeSchemaSource,
  /required:\s*\[[\s\S]*?"number"[\s\S]*?"title"[\s\S]*?"cause"[\s\S]*?"soulConnection"[\s\S]*?"dramaticMove"[\s\S]*?"characterChoice"[\s\S]*?"consequence"[\s\S]*?"endingPressure"[\s\S]*?"skeletonElementsUsed"[\s\S]*?"revelationPurpose"/,
  "The OpenAI creative schema must require the complete Soul Spine and skeleton-unit lineage."
);
assert.match(
  connectedSchemaSource,
  /required:\s*\[[\s\S]*?"number"[\s\S]*?"title"[\s\S]*?"cause"[\s\S]*?"soulConnection"[\s\S]*?"characterChoice"/,
  "The OpenAI connector schema must require every declared unit property, including Soul Spine continuity."
);
assert.match(
  creativeSchemaSource,
  /required:\s*\[[\s\S]*?"relationshipChange"[\s\S]*?"antagonistPressure"[\s\S]*?"fidelityProof"/,
  "Creative generation must explicitly plan relationship, antagonist, and Episode 1 fidelity state."
);
assert.match(
  creativeSchemaSource,
  /required:\s*\[[\s\S]*?"destinationClock"[\s\S]*?"relationshipDestination"[\s\S]*?"requiredSkeletonElements"/,
  "Creative generation must plan the destination clock and deliberately incomplete relationship destination."
);
assert.match(
  creativeSchemaSource,
  /required:\s*\[[\s\S]*?"episodeFunction"[\s\S]*?"timePhase"[\s\S]*?"locationFunction"[\s\S]*?"dramaticMove"/,
  "Creative generation must plan episode function plus temporal and spatial rhythm."
);
assert.match(
  connectedSchemaSource,
  /required:\s*\[[\s\S]*?"relationshipChange"[\s\S]*?"antagonistPressure"[\s\S]*?"fidelityProof"/,
  "Connector generation must preserve the three hidden character-pressure ledgers."
);
assert.match(
  connectedSchemaSource,
  /required:\s*\[[\s\S]*?"episodeFunction"[\s\S]*?"timePhase"[\s\S]*?"locationFunction"[\s\S]*?"characterChoice"/,
  "Connector generation must preserve episode function plus temporal and spatial rhythm."
);
assert.match(
  connectedSchemaSource,
  /required:\s*\[[\s\S]*?"endingTurn"[\s\S]*?"cliffhangerType"[\s\S]*?"relationshipChange"/,
  "Connector generation must preserve the intended cliffhanger shape."
);
assert.match(
  source,
  /required:\s*\[[\s\S]*?"number"[\s\S]*?"cause"[\s\S]*?"characterChoice"[\s\S]*?"consequence"[\s\S]*?"nextPressure"[\s\S]*?"emotionalChange"[\s\S]*?"endingTurn"[\s\S]*?"visiblePlot"/,
  "The connector schema must require every internal and writer-visible unit field."
);
assert.match(
  source,
  /Repair only the transport structure/,
  "Connector validation must repair unusable structure without rewriting a usable story."
);
assert.match(source, /requiredSkeletonElements/, "Connector validation must receive the full required skeleton map.");
assert.doesNotMatch(source, /countSentences\(unit\.visiblePlot\) > 2/, "Prose-length misses must not discard a usable batch.");
assert.doesNotMatch(source, /hasBecauseThenStructure\(unit\.visiblePlot\)/, "Because/Then wording must be generated by the prompt, not enforced by batch rejection.");
assert.doesNotMatch(source, /countWords\(unit\.visiblePlot\) > 40/, "Word-count misses must not discard a usable batch.");
assert.doesNotMatch(source, /hasWeakCliffhanger\(unit\.visiblePlot\)/, "Cliffhanger quality must be improved before emission, not rejected afterward.");
assert.match(source, /readableUnits\.length === 0/, "A connector batch may fail only when it contains no usable visible plot.");
assert.match(
  source,
  /Return exactly seven units numbered 2,3,4,5,6,7,8/,
  "Portrait repair must preserve the exact Episode 2 through Episode 8 range."
);
assert.match(actionSource, /case "retry_failed_stage"/, "Retry actions must be accepted by the API parser.");
assert.match(
  actionSource,
  /resumeStage: session\.failedStage/,
  "A retry must resume the failed orchestrated stage."
);
assert.match(
  runnerSource,
  /const artifacts: PlotLabOrchestrationArtifacts = \{[\s\S]*?\.\.\.\(input\.artifacts \?\? \{\}\)[\s\S]*?\}/,
  "A retry must reuse persisted orchestration artifacts."
);
assert.match(runnerSource, /"source_truth"[\s\S]*?"endpoint_exploration"[\s\S]*?"route_exploration"[\s\S]*?"specialist_planning"[\s\S]*?"creative_authoring"[\s\S]*?"holistic_qa"[\s\S]*?"targeted_repair"[\s\S]*?"connecting"/, "The runner must declare the full orchestrated hierarchy in order.");
assert.match(runnerSource, /artifacts\.repairAttempted = true[\s\S]*?catch \(repairError\)[\s\S]*?creativeRoute = artifacts\.preRepairRoute/, "A failed semantic repair must fall back to the readable pre-repair route.");
assert.match(runnerSource, /catch \(qaError\)[\s\S]*?verdict: "strong"[\s\S]*?readable authored route was preserved/, "Unavailable holistic QA must never block a readable authored route.");
assert.match(runnerSource, /catch \(specialistError\)[\s\S]*?specialist_degraded/, "Optional specialist failure must degrade gracefully.");
assert.match(promptSource, /exactly two distinct[\s\S]*?exactly two compact hidden route candidates/i, "Endpoint and route exploration must each create two candidates.");
assert.match(promptSource, /Trigger specialists only when their expertise can materially improve/i, "Levi must conditionally trigger specialists.");
assert.match(promptSource, /two or three natural, vivid sentences/i, "The connector must produce compact natural writer-facing plots.");
assert.match(promptSource, /PLOT LAB CREATIVE AUTHOR v2\.1[\s\S]*?flashback or memory fragment[\s\S]*?director's-cut insert[\s\S]*?intercut parallel action/i, "The Creative Author must have an optional cinematic-compression palette.");
assert.match(promptSource, /optional tools, never checklist requirements/i, "Cinematic devices must remain creative options rather than hard validation rules.");
assert.match(promptSource, /must not fully deliver or resolve the monetization revelation before the final unit/i, "The Creative Author must protect the final monetization reveal from landing early.");
assert.match(promptSource, /Do not confuse physical movement with story movement[\s\S]*?genuinely different condition/i, "Purpose construction must progress through dramatic phases instead of treating travel as story movement.");
assert.match(promptSource, /Construct microdrama, not a calm synopsis[\s\S]*?changed/i, "Purpose construction must create charged pressure, consequential turns, and changed-state endings.");
assert.match(promptSource, /Escalate by changing the kind of pressure[\s\S]*?faceless pursuers/i, "Purpose construction must vary pressure sources and avoid one long chase phase.");
assert.match(promptSource, /Write with microdrama impact[\s\S]*?emotional or practical consequence/i, "Plot writing must retain the planned drama in the concise final summary.");
assert.match(referenceFixtureSource, /const plots = plotDocument\(\[episodes\[0\]\]\)/, "Reference fixtures must expose only Episode 1 in the plot source tab.");
assert.doesNotMatch(referenceFixtureSource, /false-amnesia|staged assassination|masked attack|Noboru|Toji|King Kai|Queen Yoko|Goro/i, "Episode 1 fixtures must not leak later-series twists or characters.");
assert.match(source, /candidates: \{ type: "array", minItems: 1, maxItems: 2/, "Hidden exploration must accept one usable candidate instead of failing when a second option is absent.");
assert.match(source, /unitSpine: \{ type: "array", minItems: 1, maxItems: 8/, "Hidden routes must accept an imperfect beat count for downstream normalization.");
assert.match(source, /number: input\.orientation === "portrait" \? index \+ 2 : index \+ 1/, "Route unit numbering must be normalized as transport metadata instead of hard-failing usable story routes.");
assert.doesNotMatch(source.slice(source.indexOf("export async function exploreRoutes"), source.indexOf("export async function selectRouteAndSpecialists")), /validLength/, "Hidden route exploration must not enforce the final writer-facing unit count.");
assert.match(runnerSource, /fallbackSourceTruth[\s\S]*?fallbackEndpoints[\s\S]*?fallbackRoutes[\s\S]*?fallbackDecision[\s\S]*?fallbackCreativeRoute[\s\S]*?assembleBestReadableBatch/, "Every hidden stage must have a readable downstream fallback.");
assert.match(runnerSource, /Connector returned incomplete structure; Levi preserved the Creative Author's readable route/, "Connector structure failure must preserve authored plot prose.");
assert.match(workspaceSource, /\["queued", "orchestrating", "creative", "reviewing", "connecting"\]\.includes\(thread\.session\.phase\)/, "UI polling must continue through every orchestrated generation phase.");
assert.doesNotMatch(promptSource.slice(promptSource.indexOf("PLOT LAB STORY SPINE CONNECTOR v1.6")), /begins with the literal word Because/, "The active connector must not force literal Because/Then wording.");
assert.match(actionSource, /case "accept_output"/, "Explicit acceptance must be accepted by the API parser.");
assert.match(actionSource, /checkpoint\.purposeMap[\s\S]*?mode: "purpose_planning"[\s\S]*?previousPurposeMap: purposeMap/, "Confirmed follow-up changes must return purpose-generated batches to the same construction path.");
assert.match(workspaceSource, /Accept final/, "The latest batch must expose explicit acceptance.");
assert.match(workspaceSource, /Story movement[\s\S]*?centralTransformation/, "Purpose review must show the batch-level story movement without exposing the hidden planning form.");
assert.match(workspaceSource, /Retry generation/, "Recoverable errors must expose a retry control.");

console.log("Plot Lab V2 real-AI contract checks passed");
