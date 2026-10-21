#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const { RUBRIC_VERSION, CATEGORIES } = require("./first-pass-eval-lib.cjs");

const [judgeFile, humanFile] = process.argv.slice(2);
if (!judgeFile || !humanFile) {
  console.error("Usage: node scripts/first-pass-eval-calibrate.cjs JUDGE_REVIEW.json HUMAN_REVIEW.json");
  process.exit(2);
}

function read(filename) {
  const review = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (review.rubricVersion !== RUBRIC_VERSION || !Array.isArray(review.pairs)) {
    throw new Error(`${filename} has the wrong rubric version or shape`);
  }
  return review;
}

function labelMap(review) {
  return new Map(review.pairs.flatMap((pair) => (pair.changes ?? []).map((change) => [
    `${pair.pairId}/${change.id}`, { episode: pair.episode, ...change },
  ])));
}

try {
  const judged = labelMap(read(judgeFile));
  const human = labelMap(read(humanFile));
  let compared = 0;
  let agreed = 0;
  let materialAgreed = 0;
  let missingJudge = 0;
  const episodes = new Set();
  const disagreements = [];
  for (const [key, gold] of human) {
    if (gold.reviewed !== true || typeof gold.material !== "boolean" || (gold.material && !CATEGORIES.includes(gold.category))) continue;
    const prediction = judged.get(key);
    if (!prediction || typeof prediction.material !== "boolean" || (prediction.material && !CATEGORIES.includes(prediction.category))) {
      missingJudge++;
      continue;
    }
    compared++;
    episodes.add(gold.episode);
    if (prediction.material === gold.material) materialAgreed++;
    if (prediction.material === gold.material && (!gold.material || prediction.category === gold.category)) agreed++;
    else disagreements.push({ episode: gold.episode, changeId: gold.id, judge: { material: prediction.material, category: prediction.category }, human: { material: gold.material, category: gold.category } });
  }
  const agreementPct = compared ? Number((100 * agreed / compared).toFixed(1)) : null;
  const result = {
    rubricVersion: RUBRIC_VERSION,
    compared,
    episodes: episodes.size,
    missingJudge,
    materialAgreementPct: compared ? Number((100 * materialAgreed / compared).toFixed(1)) : null,
    fullAgreementPct: agreementPct,
    calibrationReady: compared >= 40 && episodes.size >= 10 && agreementPct >= 80,
    requirement: "At least 40 human-reviewed changes across 10 episodes and 80% exact material-plus-category agreement",
    disagreements,
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
