/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { parseScript, alignScripts, evaluatePair } = require("./first-pass-eval-lib.cjs");

function pair(firstText, finalText) {
  return { documentId: "doc", episode: 1, firstId: "first", finalId: "final", firstText, finalText };
}

function testParser() {
  const units = parseScript(`Episode 1\nSeq 1 - Bakery | night | Izumi\n(Visual: The door opens.)\nIZUMI (shaking): "Go now!" [urgent]\nIZUMI (V.O.): "Too late." [afraid]\nbroken fragment`);
  assert.deepEqual(units.map((unit) => unit.kind), ["sequence", "visual", "dialogue", "vo", "other"]);
  assert.equal(units[2].speaker, "IZUMI");
}

function testExactAndPunctuation() {
  const result = evaluatePair(pair(`Episode 1\nA: "Go!"`, `EPISODE 1\nA: “Go.”`));
  assert.equal(result.fitScore, 100);
  assert.equal(result.pendingGroups, 0);
}

function testMaterialDeduction() {
  const input = pair(`Episode 1\nA: "Go."\n(Visual: Door closes.)`, `Episode 1\nA: "Run now."\n(Visual: Door closes.)`);
  const initial = evaluatePair(input);
  const change = initial.changes.find((item) => item.operation !== "unchanged");
  const result = evaluatePair(input, { [change.id]: { material: true, category: "dialogue_vo", reviewed: true } });
  assert.equal(result.fitScore, 50);
  assert.equal(result.deductionsPct.dialogue_vo, 50);
  assert.equal(result.scoreStatus, "reviewed");
}

function testAdditionAndPending() {
  const input = pair(`Episode 1\nA: "Go."`, `Episode 1\nA: "Go."\n(Visual: Door opens.)`);
  const initial = evaluatePair(input);
  assert.equal(initial.fitScore, null);
  assert.equal(initial.pendingGroups, 1);
  const added = initial.changes.find((item) => item.operation === "added");
  const result = evaluatePair(input, { [added.id]: { material: true, category: "visual_storytelling" } });
  assert.equal(result.fitScore, 50);
  assert.equal(result.scoreStatus, "provisional");
}

function testMoveAndSplit() {
  const moved = alignScripts(
    parseScript(`A: "First."\nB: "Second."`),
    parseScript(`B: "Second."\nA: "First."`)
  );
  assert.ok(moved.some((item) => item.operation === "moved"));
  const split = alignScripts(
    parseScript(`A: "Call her off now."`),
    parseScript(`A: "Call her off."\nA: "Now."`)
  );
  assert.equal(split.length, 1);
  assert.equal(split[0].operation, "split");
  assert.equal(split[0].weight, 2);
}

function testCafeAnchor() {
  const aligned = alignScripts(
    parseScript(`MASARU (smiling wider): "It's good business." [smug]`),
    parseScript(`MASARU: "Its just good business." [cold]`)
  );
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].operation, "rewritten");
}

testParser();
testExactAndPunctuation();
testMaterialDeduction();
testAdditionAndPending();
testMoveAndSplit();
testCafeAnchor();
console.log("first-pass-eval tests passed");
