#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const { RUBRIC_VERSION, CATEGORIES } = require("./first-pass-eval-lib.cjs");

const [baselineFile, candidateFile] = process.argv.slice(2);
if (!baselineFile || !candidateFile) {
  console.error("Usage: node scripts/first-pass-eval-trend.cjs BASELINE/metrics.json CANDIDATE/metrics.json");
  process.exit(2);
}

function read(filename) {
  const data = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (data.rubricVersion !== RUBRIC_VERSION || !Array.isArray(data.episodes)) {
    throw new Error(`${filename} has wrong rubric version or shape`);
  }
  return data.episodes;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

try {
  const baseline = new Map(read(baselineFile).map((item) => [`${item.episode}/${item.finalSnapshotId}`, item]));
  const candidate = read(candidateFile);
  const paired = [];
  const excluded = [];
  for (const current of candidate) {
    const before = baseline.get(`${current.episode}/${current.finalSnapshotId}`);
    if (!before) {
      excluded.push({ episode: current.episode, reason: "no_same_accepted_final" });
    } else if (before.scoreStatus !== "reviewed" || current.scoreStatus !== "reviewed") {
      excluded.push({ episode: current.episode, reason: "score_not_human_reviewed" });
    } else if (before.firstSnapshotId === current.firstSnapshotId) {
      excluded.push({ episode: current.episode, reason: "same_first_generation" });
    } else {
      paired.push({
        episode: current.episode,
        baselineFit: before.fitScore,
        candidateFit: current.fitScore,
        fitChange: Number((current.fitScore - before.fitScore).toFixed(1)),
        baselineWordEditRate: before.wordEditRate,
        candidateWordEditRate: current.wordEditRate,
        categoryPointChanges: Object.fromEntries(CATEGORIES.map((category) => [category, Number(((current.deductionsPct[category] ?? 0) - (before.deductionsPct[category] ?? 0)).toFixed(1))])),
      });
    }
  }
  const changes = paired.map((item) => item.fitChange);
  console.log(JSON.stringify({
    rubricVersion: RUBRIC_VERSION,
    pairedEpisodes: paired.length,
    medianPairedFitChange: median(changes),
    episodesImproved: changes.filter((value) => value > 0).length,
    episodesDeclined: changes.filter((value) => value < 0).length,
    episodesUnchanged: changes.filter((value) => value === 0).length,
    paired,
    excluded,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
