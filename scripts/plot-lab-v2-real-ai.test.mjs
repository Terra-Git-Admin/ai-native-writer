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
const creativeSchemaSource = source.slice(
  source.indexOf("const creativeOutput"),
  source.indexOf("const connectedOutput")
);
const connectedSchemaSource = source.slice(
  source.indexOf("const connectedOutput"),
  source.indexOf("function configuredModelIds")
);

assert.match(
  source,
  /output:\s*connectedOutput/,
  "Connector generation must use the AI SDK structured-output contract."
);
assert.match(
  creativeSchemaSource,
  /required:\s*\[[\s\S]*?"number"[\s\S]*?"title"[\s\S]*?"dramaticMove"[\s\S]*?"characterChoice"[\s\S]*?"consequence"[\s\S]*?"endingPressure"/,
  "The OpenAI creative schema must require every declared unit property, including title."
);
assert.match(
  connectedSchemaSource,
  /required:\s*\[[\s\S]*?"number"[\s\S]*?"title"[\s\S]*?"cause"[\s\S]*?"characterChoice"/,
  "The OpenAI connector schema must require every declared unit property, including title."
);
assert.match(
  source,
  /required:\s*\[[\s\S]*?"number"[\s\S]*?"cause"[\s\S]*?"characterChoice"[\s\S]*?"consequence"[\s\S]*?"nextPressure"[\s\S]*?"emotionalChange"[\s\S]*?"endingTurn"[\s\S]*?"visiblePlot"/,
  "The connector schema must require every internal and writer-visible unit field."
);
assert.match(
  source,
  /Repair the supplied Plot Lab connector JSON/,
  "Connector validation must attempt one structure repair before failing the job."
);
assert.match(
  source,
  /Return exactly seven units numbered 2,3,4,5,6,7,8/,
  "Portrait repair must preserve the exact Episode 2 through Episode 8 range."
);
assert.match(actionSource, /case "retry_failed_stage"/, "Retry actions must be accepted by the API parser.");
assert.match(
  actionSource,
  /creativeUnits: checkpoint\.creativeUnits/,
  "A connector retry must reuse the saved creative checkpoint."
);
assert.match(
  runnerSource,
  /input\.resumeStage !== "connecting"/,
  "A connector retry must skip creative generation."
);
assert.match(workspaceSource, /Retry generation/, "Recoverable errors must expose a retry control.");

console.log("Plot Lab V2 real-AI contract checks passed");
