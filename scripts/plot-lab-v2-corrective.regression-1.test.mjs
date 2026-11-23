// Regression: ISSUE-001 — Plot Lab completion must preserve the skeleton and allow follow-up chat
// Found by /qa on 2026-11-23
// Report: .gstack/qa-reports/qa-report-plot-lab-v2-2026-11-23.md
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  countSentences,
  findMissingSkeletonElement,
} from "../src/lib/plot-lab-v2/output-validation.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [prompts, realAI, actionService, workspace, contracts] = await Promise.all([
  read("../src/lib/plot-lab-v2/prompts.ts"),
  read("../src/lib/plot-lab-v2/real-ai.ts"),
  read("../src/lib/plot-lab-v2/action-service.ts"),
  read("../src/components/labs/PlotLabV2Workspace.tsx"),
  read("../src/lib/plot-lab-v2/contracts.ts"),
]);

assert.match(prompts, /EP1 SOUL SPINE/i, "Prompts must lock the Episode 1 soul before extending the story.");
assert.match(prompts, /EPISODE LOOP/i, "Prompts must use an explicit incoming-pressure to outgoing-pressure loop.");
assert.match(prompts, /every required skeleton element/i, "The connector must treat every supplied skeleton element as required in-range material.");
assert.match(realAI, /countSentences/, "Connected-output parsing must enforce the one-or-two-sentence visible contract.");
assert.match(realAI, /requiredSkeletonElements/, "Creative output must carry a required skeleton map into the connector.");
assert.match(realAI, /skeletonElementsUsed/, "Each creative unit must record the skeleton material it advances.");
assert.match(realAI, /storyBrief: session\.interviewCheckpoint\.characterBrief/, "The hidden Story Brief must feed generation context.");
assert.match(actionService, /case "chat"/, "The API parser must accept post-batch chat actions.");
assert.match(actionService, /generateRealConversationTurn/, "Complete-phase chat must call the versioned conversation path.");
assert.match(actionService, /characterBrief: turn\.storyBrief/, "Each interview turn must persist the hidden Story Brief.");
assert.match(workspace, /kind: "chat"/, "The completed-session composer must send a chat action.");
assert.doesNotMatch(workspace, /Follow-up chat arrives in the next slice/, "The completed-session composer must no longer advertise missing chat.");
assert.match(contracts, /soulConnection/, "Connected units must preserve hidden EP1-soul lineage.");
assert.match(contracts, /skeletonElementsUsed/, "Connected units must preserve hidden skeleton coverage lineage.");

assert.equal(countSentences("Mira chooses the dangerous route."), 1);
assert.equal(countSentences("Mira chooses the dangerous route. Ilan realizes she lied."), 2);
assert.equal(countSentences("Mira chooses the route. Ilan follows. The Exchange seals the exit."), 3);
assert.equal(
  findMissingSkeletonElement({
    required: ["Mira is the secret princess", "Mira falls for Ilan's son"],
    unitElements: ["Mira is the secret princess"],
    coverage: [{ element: "Mira is the secret princess", unitNumbers: [7] }],
    allowedUnitNumbers: [2, 3, 4, 5, 6, 7, 8],
  }),
  "Mira falls for Ilan's son",
  "A required skeleton beat cannot be deferred beyond the current batch."
);

console.log("Plot Lab V2 corrective regression checks passed");
