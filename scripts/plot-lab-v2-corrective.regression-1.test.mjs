// Regression: ISSUE-001 — Plot Lab completion must preserve the skeleton and allow follow-up chat
// Found by /qa on 2026-11-23
// Report: .gstack/qa-reports/qa-report-plot-lab-v2-2026-11-23.md
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  countSentences,
  countWords,
  findMissingSkeletonElement,
  hasBecauseThenStructure,
  hasWeakCliffhanger,
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
assert.match(prompts, /FIVE-SECOND TEST/, "Portrait cliffhangers must be immediate enough to drive the next episode.");
assert.match(prompts, /irreversible/, "Portrait cliffhangers must lock a real story-state change.");
assert.match(prompts, /continuity ledger/i, "The connector must audit the complete causal chain before compressing episodes.");
assert.match(prompts, /quality pass over all seven visible plots/i, "The connector must repair prose quality before returning the batch.");
assert.match(prompts, /three interlocking chains/i, "Generation must interlock plot, relationship, and antagonist progression.");
assert.match(prompts, /deliberate breathing-space/i, "Relationship pacing must allow episodes without a forced romance beat.");
assert.match(prompts, /speech density/i, "Character continuation must preserve the Episode 1 behavioral fingerprint.");
assert.match(prompts, /Never relabel an explicit writer seed as pending approval/i, "Writer-supplied seeds must be treated as approved story material.");
assert.doesNotMatch(realAI, /countSentences\(unit\.visiblePlot\)/, "A prose miss in one episode must not abort the complete batch.");
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
assert.match(contracts, /relationshipChange/, "Connected units must preserve hidden relationship progression.");
assert.match(contracts, /antagonistPressure/, "Connected units must preserve hidden antagonist progression.");
assert.match(contracts, /fidelityProof/, "Connected units must preserve Episode 1 character behavior.");

assert.equal(countSentences("Mira chooses the dangerous route."), 1);
assert.equal(countSentences("Mira chooses the dangerous route. Ilan realizes she lied."), 2);
assert.equal(countSentences("Mira chooses the route. Ilan follows. The Exchange seals the exit."), 3);
assert.equal(
  hasBecauseThenStructure("Because Mira steals the ledger, Ilan loses his last bargaining chip. Then the Exchange brands her location across every city screen."),
  true
);
assert.equal(hasBecauseThenStructure("Mira steals the ledger. The Exchange follows her."), false);
assert.equal(hasWeakCliffhanger("Because Mira steals the ledger, Ilan loses his leverage. Then she must decide whether to trust him."), true);
assert.equal(hasWeakCliffhanger("Because Mira steals the ledger, Ilan loses his leverage. Then an Exchange sniper fires at Ilan."), false);
assert.equal(countWords("Because Mira runs. Then Ilan fires."), 6);
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
