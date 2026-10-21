/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto");

const RUBRIC_VERSION = "first-pass-fit-v1";
const CATEGORIES = [
  "story_truth",
  "episode_shape",
  "character_emotion",
  "dialogue_vo",
  "visual_storytelling",
  "script_form",
  "other",
];

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function cleanLine(line) {
  return line.replace(/^\s*\[(?:H\d|P|UL|OL)\]\s*/i, "").trim().replace(/\s+/g, " ");
}

function wordTokens(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function comparable(text) {
  return wordTokens(text).join(" ");
}

function parseScript(text) {
  const units = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line || /^episode\s*#?\s*\d+\b/i.test(line)) continue;
    let kind = "other";
    let speaker = null;
    if (/^seq\s*\d+\b/i.test(line)) kind = "sequence";
    else if (/^\(visual\s*:/i.test(line)) kind = "visual";
    else {
      const match = line.match(/^([\p{L}\p{N} _.'’\-]{1,55})(?:\s*\([^)]*\))?\s*:/u);
      if (match && match[1] === match[1].toUpperCase()) {
        kind = /\bV\.?O\.?\b/i.test(line.slice(0, line.indexOf(":"))) ? "vo" : "dialogue";
        speaker = match[1].trim().toUpperCase();
      }
    }
    units.push({ index: units.length, kind, speaker, text: line, key: comparable(line) });
  }
  return units;
}

function tokenDice(a, b) {
  const left = wordTokens(a);
  const right = wordTokens(b);
  if (!left.length && !right.length) return 1;
  if (!left.length || !right.length) return 0;
  const counts = new Map();
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of right) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      shared++;
      counts.set(token, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

function compatible(first, final) {
  if (!first.length || !final.length) return false;
  const kinds = new Set([...first, ...final].map((unit) => unit.kind));
  if (kinds.size > 1) return false;
  if (kinds.has("dialogue") || kinds.has("vo")) {
    const speakers = new Set([...first, ...final].map((unit) => unit.speaker));
    if (speakers.size > 1) return false;
  }
  return true;
}

function unitContent(unit) {
  if (unit.kind === "dialogue" || unit.kind === "vo") {
    const quote = unit.text.match(/["“]([^"”]+)["”]/u);
    return quote ? quote[1] : unit.text.slice(unit.text.indexOf(":") + 1);
  }
  if (unit.kind === "visual") return unit.text.replace(/^\(Visual\s*:\s*/i, "").replace(/\)$/, "");
  return unit.text;
}

function matchCost(first, final) {
  if (!compatible(first, final)) return Number.POSITIVE_INFINITY;
  const before = first.map(unitContent).join(" ");
  const after = final.map(unitContent).join(" ");
  const lexical = tokenDice(before, after);
  if (lexical < 0.12 && first[0].kind !== "dialogue" && first[0].kind !== "vo") {
    return Number.POSITIVE_INFINITY;
  }
  const splitPenalty = first.length === final.length ? 0 : 0.45;
  return 0.12 + (1 - lexical) + splitPenalty;
}

function group(first, final, operation = null) {
  const before = first.map((unit) => unit.text).join("\n");
  const after = final.map((unit) => unit.text).join("\n");
  const same = first.length === 1 && final.length === 1 && first[0].key === final[0].key && first[0].kind === final[0].kind;
  const kind = first[0]?.kind ?? final[0]?.kind ?? "other";
  return {
    id: hash(`${first.map((unit) => unit.index).join(",")}|${final.map((unit) => unit.index).join(",")}|${before}|${after}`),
    firstIndices: first.map((unit) => unit.index),
    finalIndices: final.map((unit) => unit.index),
    firstText: before,
    finalText: after,
    kind,
    speaker: first[0]?.speaker ?? final[0]?.speaker ?? null,
    operation: operation ?? (same ? "unchanged" : !first.length ? "added" : !final.length ? "removed" : first.length < final.length ? "split" : first.length > final.length ? "merged" : "rewritten"),
    weight: Math.max(first.length, final.length),
  };
}

function alignScripts(firstUnits, finalUnits) {
  const n = firstUnits.length;
  const m = finalUnits.length;
  const width = m + 1;
  const costs = new Float64Array((n + 1) * (m + 1)).fill(Number.POSITIVE_INFINITY);
  const moves = new Array((n + 1) * (m + 1));
  costs[0] = 0;
  const steps = [
    { a: 1, b: 1, name: "pair" },
    { a: 1, b: 2, name: "split" },
    { a: 2, b: 1, name: "merge" },
    { a: 1, b: 0, name: "remove" },
    { a: 0, b: 1, name: "add" },
  ];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const base = costs[i * width + j];
      if (!Number.isFinite(base)) continue;
      for (const step of steps) {
        const ni = i + step.a;
        const nj = j + step.b;
        if (ni > n || nj > m) continue;
        const cost = step.a && step.b
          ? matchCost(firstUnits.slice(i, ni), finalUnits.slice(j, nj))
          : 0.8;
        const target = ni * width + nj;
        if (base + cost < costs[target]) {
          costs[target] = base + cost;
          moves[target] = { i, j, step };
        }
      }
    }
  }
  const aligned = [];
  let i = n;
  let j = m;
  while (i || j) {
    const move = moves[i * width + j];
    if (!move) throw new Error(`Could not align units at ${i}, ${j}`);
    aligned.push(group(firstUnits.slice(move.i, i), finalUnits.slice(move.j, j)));
    i = move.i;
    j = move.j;
  }
  aligned.reverse();

  // Pair a unit moved to another position without charging its words as a rewrite.
  const removed = new Map();
  for (const item of aligned) {
    if (item.operation !== "removed") continue;
    const unit = firstUnits[item.firstIndices[0]];
    const key = `${unit.kind}|${unit.key}`;
    if (!removed.has(key)) removed.set(key, []);
    removed.get(key).push(item);
  }
  const consumed = new Set();
  for (const item of aligned) {
    if (item.operation !== "added") continue;
    const unit = finalUnits[item.finalIndices[0]];
    const queue = removed.get(`${unit.kind}|${unit.key}`);
    if (!queue?.length) continue;
    const old = queue.shift();
    old.finalIndices = item.finalIndices;
    old.finalText = item.finalText;
    old.operation = "moved";
    old.id = hash(`${old.firstIndices.join(",")}|${old.finalIndices.join(",")}|${old.firstText}|${old.finalText}`);
    consumed.add(item);
  }
  return aligned.filter((item) => !consumed.has(item));
}

function wordDistance(before, after) {
  const a = wordTokens(before);
  const b = wordTokens(after);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1])
      );
    }
    previous = current;
  }
  return { firstWords: a.length, finalWords: b.length, edits: previous[b.length] };
}

function evaluatePair(pair, labels = {}) {
  const firstUnits = parseScript(pair.firstText);
  const finalUnits = parseScript(pair.finalText);
  const aligned = alignScripts(firstUnits, finalUnits);
  const pairId = hash(`${pair.documentId}|${pair.episode}|${pair.firstId}|${pair.finalId}|${pair.firstText}|${pair.finalText}`);
  let firstWords = 0;
  let finalWords = 0;
  let wordEdits = 0;
  let movedUnits = 0;
  let materialWeight = 0;
  let labelled = 0;
  let reviewed = 0;
  const deductions = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  const changes = aligned.map((item) => {
    const words = wordDistance(item.firstText, item.finalText);
    firstWords += words.firstWords;
    finalWords += words.finalWords;
    wordEdits += item.operation === "moved" ? 0 : words.edits;
    if (item.operation === "moved") movedUnits += item.weight;
    const saved = labels[item.id] ?? {};
    const material = item.operation === "unchanged" ? false : typeof saved.material === "boolean" ? saved.material : null;
    const category = material === true && CATEGORIES.includes(saved.category) ? saved.category : null;
    const complete = material === false || (material === true && category !== null);
    if (item.operation !== "unchanged" && complete) {
      labelled++;
      if (saved.reviewed === true) reviewed++;
    }
    if (material === true && category) {
      materialWeight += item.weight;
      deductions[category] += item.weight;
    }
    return { ...item, material, category, reviewed: saved.reviewed === true, rationale: saved.rationale ?? null };
  });
  const pending = changes.filter((item) => item.operation !== "unchanged" && (item.material === null || (item.material && !item.category))).length;
  const totalWeight = changes.reduce((sum, item) => sum + item.weight, 0);
  const score = pending === 0 && totalWeight > 0 ? Number((100 * (1 - materialWeight / totalWeight)).toFixed(1)) : null;
  const deductionsPct = Object.fromEntries(CATEGORIES.map((category) => [category, score === null ? null : Number((100 * deductions[category] / totalWeight).toFixed(1))]));
  return {
    pairId,
    documentId: pair.documentId,
    episode: pair.episode,
    exportId: pair.exportId ?? null,
    firstId: pair.firstId,
    finalId: pair.finalId,
    generationRunId: pair.generationRunId ?? null,
    firstChars: pair.firstText.length,
    finalChars: pair.finalText.length,
    firstWords,
    finalWords,
    firstUnits: firstUnits.length,
    finalUnits: finalUnits.length,
    dialogueFirst: firstUnits.filter((unit) => unit.kind === "dialogue").length,
    dialogueFinal: finalUnits.filter((unit) => unit.kind === "dialogue").length,
    voFirst: firstUnits.filter((unit) => unit.kind === "vo").length,
    voFinal: finalUnits.filter((unit) => unit.kind === "vo").length,
    visualFirst: firstUnits.filter((unit) => unit.kind === "visual").length,
    visualFinal: finalUnits.filter((unit) => unit.kind === "visual").length,
    sequenceFirst: firstUnits.filter((unit) => unit.kind === "sequence").length,
    sequenceFinal: finalUnits.filter((unit) => unit.kind === "sequence").length,
    wordEdits,
    wordEditRate: firstWords ? Number((100 * wordEdits / firstWords).toFixed(1)) : null,
    movedUnits,
    totalWeight,
    materialWeight: score === null ? null : materialWeight,
    fitScore: score,
    deductionsPct,
    changedGroups: changes.filter((item) => item.operation !== "unchanged").length,
    labelledGroups: labelled,
    reviewedGroups: reviewed,
    pendingGroups: pending,
    scoreStatus: score === null ? "pending" : reviewed === labelled ? "reviewed" : "provisional",
    changes,
  };
}

module.exports = {
  RUBRIC_VERSION,
  CATEGORIES,
  parseScript,
  alignScripts,
  wordDistance,
  evaluatePair,
};
