#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { RUBRIC_VERSION, CATEGORIES, evaluatePair } = require("./first-pass-eval-lib.cjs");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    if (key === "--judge" || key === "--allow-paid-ai") {
      options[key.slice(2)] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  if (!options.out) throw new Error("--out is required");
  if (Boolean(options["pairs-json"]) === Boolean(options.db)) {
    throw new Error("Provide exactly one of --pairs-json or --db");
  }
  if (options.db && !options.manifest) throw new Error("--manifest is required with --db");
  if (options.judge && options.labels) throw new Error("Use either --judge or --labels");
  if (options.judge && (!options["allow-paid-ai"] || !options["judge-provider"] || !options["judge-model"] || !options["max-calls"])) {
    throw new Error("Paid judging requires --allow-paid-ai, --judge-provider, --judge-model, and --max-calls");
  }
  return options;
}

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.resolve(filename), "utf8"));
}

function loadCachedPairs(filename) {
  const data = loadJson(filename);
  if (!Array.isArray(data.rows) || typeof data.docId !== "string") throw new Error("Invalid cached pair file");
  const pairs = [];
  const excluded = [];
  for (const row of data.rows) {
    if (!row.first?.text || !row.final?.text || row.first.generation_run_id !== row.final.generation_run_id) {
      excluded.push({ episode: row.episode ?? null, reason: "missing_text_or_run_mismatch" });
      continue;
    }
    if (row.first.snapshot_kind !== "first_generation" || row.final.snapshot_kind !== "final_export") {
      excluded.push({ episode: row.episode ?? null, reason: "wrong_snapshot_kind" });
      continue;
    }
    pairs.push({
      documentId: data.docId,
      episode: row.episode,
      exportId: null,
      firstId: row.first.id,
      finalId: row.final.id,
      generationRunId: row.generationRunId,
      firstText: row.first.text,
      finalText: row.final.text,
    });
  }
  return { pairs, excluded, selectedExports: null, source: "cached_pairs" };
}

function loadDatabasePairs(dbFilename, manifestFilename) {
  const Database = require("better-sqlite3");
  const manifest = loadJson(manifestFilename);
  if (typeof manifest.documentId !== "string" || !Array.isArray(manifest.exportIds) || !manifest.exportIds.length) {
    throw new Error("Manifest needs documentId and nonempty exportIds");
  }
  const cutoff = Date.parse(manifest.cutoff);
  if (!Number.isFinite(cutoff)) throw new Error("Manifest cutoff must be an ISO date-time");
  const db = new Database(path.resolve(dbFilename), { readonly: true, fileMustExist: true });
  try {
    const ids = [...new Set(manifest.exportIds)];
    const placeholders = ids.map(() => "?").join(",");
    const events = db.prepare(`
      select * from content_export_events
      where document_id = ? and export_id in (${placeholders}) and created_at <= ?
      order by created_at desc, id desc
    `).all(manifest.documentId, ...ids, Math.floor(cutoff / 1000));
    const snapshot = db.prepare("select * from content_text_snapshots where id = ? and document_id = ?");
    const firstByRun = db.prepare(`
      select * from content_text_snapshots
      where document_id = ? and generation_run_id = ? and snapshot_kind = 'first_generation'
        and (episode_number = ? or episode_number is null)
      order by case when episode_number = ? then 0 else 1 end, created_at asc, id asc limit 1
    `);
    const overrides = new Map((manifest.pairOverrides ?? []).map((item) => [item.exportEventId, item.firstSnapshotId]));
    const selected = new Map();
    for (const event of events) {
      const key = event.episode_number ?? event.section_uid ?? event.id;
      if (!selected.has(key)) selected.set(key, event);
    }
    const pairs = [];
    const excluded = [];
    for (const event of selected.values()) {
      const episode = event.episode_number;
      const final = event.snapshot_id ? snapshot.get(event.snapshot_id, manifest.documentId) : null;
      const overrideId = overrides.get(event.id);
      const first = overrideId
        ? snapshot.get(overrideId, manifest.documentId)
        : event.generation_run_id
          ? firstByRun.get(manifest.documentId, event.generation_run_id, episode, episode)
          : null;
      let reason = null;
      if (episode == null) reason = "missing_episode_number";
      else if (!final || final.snapshot_kind !== "final_export") reason = "missing_final_export_snapshot";
      else if (final.text_hash !== event.text_hash) reason = "export_final_hash_mismatch";
      else if (final.episode_number != null && final.episode_number !== episode) reason = "final_episode_mismatch";
      else if (/content_similarity/i.test(`${event.match_reason ?? ""} ${final.match_reason ?? ""}`) && !overrideId) reason = "similarity_pair_needs_review";
      else if (!first || first.snapshot_kind !== "first_generation") reason = "missing_exact_first_generation";
      else if (first.episode_number != null && first.episode_number !== episode) reason = "first_episode_mismatch";
      else if (first.created_at > event.created_at) reason = "first_after_export";
      else if (!overrideId && first.generation_run_id !== event.generation_run_id) reason = "run_mismatch";
      if (reason) {
        excluded.push({ episode, exportId: event.export_id, exportEventId: event.id, reason });
        continue;
      }
      pairs.push({
        documentId: manifest.documentId,
        episode,
        exportId: event.export_id,
        firstId: first.id,
        finalId: final.id,
        generationRunId: first.generation_run_id,
        firstText: first.text_raw,
        finalText: final.text_raw,
      });
    }
    const foundIds = new Set(events.map((event) => event.export_id));
    for (const id of ids) if (!foundIds.has(id)) excluded.push({ episode: null, exportId: id, reason: "export_not_found_before_cutoff" });
    pairs.sort((a, b) => a.episode - b.episode);
    return { pairs, excluded, selectedExports: selected.size, source: "sqlite_snapshot" };
  } finally {
    db.close();
  }
}

function labelsFromReview(review) {
  if (review.rubricVersion !== RUBRIC_VERSION || !Array.isArray(review.pairs)) {
    throw new Error("Labels file has wrong rubric version or shape");
  }
  return new Map(review.pairs.map((pair) => [
    pair.pairId,
    Object.fromEntries((pair.changes ?? []).map((change) => [change.id, change])),
  ]));
}

async function judgePairs(evaluations, options) {
  const { generateText } = await import("ai");
  const provider = options["judge-provider"];
  const modelId = options["judge-model"];
  const providers = {
    google: { package: "@ai-sdk/google", factory: "createGoogleGenerativeAI", key: "GOOGLE_GENERATIVE_AI_API_KEY" },
    anthropic: { package: "@ai-sdk/anthropic", factory: "createAnthropic", key: "ANTHROPIC_API_KEY" },
    openai: { package: "@ai-sdk/openai", factory: "createOpenAI", key: "OPENAI_API_KEY" },
  };
  const configuration = providers[provider];
  if (!configuration) throw new Error(`Unsupported judge provider: ${provider}`);
  const apiKey = process.env[configuration.key];
  if (!apiKey) throw new Error(`${configuration.key} is required for paid judging`);
  const sdk = await import(configuration.package);
  const model = sdk[configuration.factory]({ apiKey })(modelId);
  const maxCalls = Number(options["max-calls"]);
  if (!Number.isInteger(maxCalls) || maxCalls < 1) throw new Error("--max-calls must be a positive integer");
  let calls = 0;
  const pairs = [];
  for (const episode of evaluations) {
    const changes = episode.changes.filter((change) => change.operation !== "unchanged");
    const labelled = [];
    for (let start = 0; start < changes.length; start += 8) {
      if (calls >= maxCalls) throw new Error(`Stopped before exceeding --max-calls=${maxCalls}; no partial judge report was written`);
      const chunk = changes.slice(start, start + 8);
      const request = chunk.map((change) => ({
        id: change.id,
        operation: change.operation,
        first: change.firstText,
        final: change.finalText,
      }));
      const response = await generateText({
        model,
        system: `You classify editorial changes in a script. The FINAL is the accepted reference. For each provided edit, decide whether it materially changes story information, scene structure, character emotion or intent, dialogue voice/rhythm, visual action, or production-required script form. Ignore case, whitespace, and minor punctuation. Do not judge either script's absolute quality. Give one primary category from ${CATEGORIES.join(", ")}; use null if material=false. Return ONLY a JSON array of objects {id, material, category, rationale}. Preserve every input id exactly. Rubric ${RUBRIC_VERSION}.`,
        prompt: JSON.stringify({ episode: episode.episode, changes: request }),
        temperature: 0,
      });
      calls++;
      let answer;
      try { answer = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
      catch { throw new Error(`Judge returned invalid JSON for episode ${episode.episode}`); }
      if (!Array.isArray(answer) || answer.length !== chunk.length) throw new Error(`Judge omitted changes for episode ${episode.episode}`);
      const byId = new Map(answer.map((item) => [item.id, item]));
      for (const change of chunk) {
        const item = byId.get(change.id);
        if (!item || typeof item.material !== "boolean" || (item.material && !CATEGORIES.includes(item.category))) {
          throw new Error(`Invalid judge label for ${change.id}`);
        }
        labelled.push({ ...change, material: item.material, category: item.material ? item.category : null, rationale: String(item.rationale ?? "").slice(0, 500), reviewed: false });
      }
    }
    pairs.push({ pairId: episode.pairId, episode: episode.episode, changes: labelled });
  }
  return { rubricVersion: RUBRIC_VERSION, judge: { provider, modelId, calls }, pairs };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
}

function writeReports(outputDirectory, input, evaluations, review, judge = null) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "review.json"), JSON.stringify(review, null, 2) + "\n");
  const columns = [
    "episode", "pair_id", "export_id", "first_snapshot_id", "final_snapshot_id", "first_chars", "final_chars",
    "first_words", "final_words", "word_edits", "word_edit_rate_pct", "moved_units", "first_units", "final_units",
    "dialogue_first", "dialogue_final", "vo_first", "vo_final", "visual_first", "visual_final", "sequence_first", "sequence_final",
    "fit_score", "score_status", "changed_groups", "labelled_groups", "reviewed_groups", "pending_groups",
    ...CATEGORIES.map((category) => `${category}_points_lost`),
  ];
  const rows = evaluations.map((episode) => [
    episode.episode, episode.pairId, episode.exportId, episode.firstId, episode.finalId, episode.firstChars, episode.finalChars,
    episode.firstWords, episode.finalWords, episode.wordEdits, episode.wordEditRate, episode.movedUnits, episode.firstUnits, episode.finalUnits,
    episode.dialogueFirst, episode.dialogueFinal, episode.voFirst, episode.voFinal, episode.visualFirst, episode.visualFinal, episode.sequenceFirst, episode.sequenceFinal,
    episode.fitScore, episode.scoreStatus, episode.changedGroups, episode.labelledGroups, episode.reviewedGroups, episode.pendingGroups,
    ...CATEGORIES.map((category) => episode.deductionsPct[category]),
  ]);
  fs.writeFileSync(path.join(outputDirectory, "episode-scores.csv"), [columns.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n") + "\n");
  const coverage = {
    source: input.source,
    selectedExports: input.selectedExports,
    matchedEpisodes: evaluations.length,
    excluded: input.excluded,
    rubricVersion: RUBRIC_VERSION,
    judge: judge?.judge ?? null,
  };
  fs.writeFileSync(path.join(outputDirectory, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "metrics.json"), JSON.stringify({
    rubricVersion: RUBRIC_VERSION,
    source: input.source,
    episodes: evaluations.map((episode) => ({
      episode: episode.episode,
      finalSnapshotId: episode.finalId,
      firstSnapshotId: episode.firstId,
      fitScore: episode.fitScore,
      scoreStatus: episode.scoreStatus,
      wordEditRate: episode.wordEditRate,
      deductionsPct: episode.deductionsPct,
    })),
  }, null, 2) + "\n");
  const reviewedScores = evaluations.filter((episode) => episode.scoreStatus === "reviewed").map((episode) => episode.fitScore);
  const lines = [
    "# First generation → accepted final report",
    "",
    `Rubric: ${RUBRIC_VERSION}. Source: ${input.source}. Matched episodes: ${evaluations.length}; excluded: ${input.excluded.length}.`,
    "",
    `Reviewed median first-pass fit: ${reviewedScores.length ? `${median(reviewedScores)}/100 across ${reviewedScores.length} episodes` : "pending review"}.`,
    "AI-only fit scores are provisional. This report measures revision burden against the accepted final, not absolute script quality or human time.",
    "",
    "| Episode | Fit / 100 | Status | Word edit rate | Points lost by category |",
    "| --- | ---: | --- | ---: | --- |",
    ...evaluations.map((episode) => {
      const categories = CATEGORIES.filter((category) => (episode.deductionsPct[category] ?? 0) > 0)
        .map((category) => `${category.replaceAll("_", " ")} ${episode.deductionsPct[category]}`)
        .join(", ");
      return `| ${episode.episode} | ${episode.fitScore ?? "Pending"} | ${episode.scoreStatus} | ${episode.wordEditRate ?? "—"}% | ${categories || "—"} |`;
    }),
    "",
    "Word edit rate is computed within aligned passages; unchanged moved passages are counted separately. It may exceed 100% when the final adds substantial text.",
    "Category points sum to 100 minus the fit score before rounding. Unlabelled passages leave the fit score pending.",
    "",
    "## Coverage and review",
    "",
    `- Matched episode pairs: ${evaluations.length}`,
    `- Excluded export/episode rows: ${input.excluded.length}`,
    `- Pending change labels: ${evaluations.reduce((sum, episode) => sum + episode.pendingGroups, 0)}`,
    `- Reviewed change labels: ${evaluations.reduce((sum, episode) => sum + episode.reviewedGroups, 0)}`,
    "- Historical capture completeness is unknown without a generation-attempt denominator.",
    "- Use `review.json` locally to inspect and label aligned passages; it contains script text and must stay out of Git and shared summaries.",
    "",
  ];
  fs.writeFileSync(path.join(outputDirectory, "summary.md"), lines.join("\n"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDirectory = path.resolve(options.out);
  const repoRoot = path.resolve(__dirname, "..");
  const relative = path.relative(repoRoot, outputDirectory);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("--out must be outside the Git worktree because review.json contains script text");
  }
  const existingReview = path.join(outputDirectory, "review.json");
  if (fs.existsSync(existingReview) && (!options.labels || path.resolve(options.labels) !== existingReview)) {
    throw new Error("Output already contains review.json. Reuse it with --labels <out>/review.json, or choose a new output directory");
  }
  const input = options["pairs-json"]
    ? loadCachedPairs(options["pairs-json"])
    : loadDatabasePairs(options.db, options.manifest);
  let labels = options.labels ? labelsFromReview(loadJson(options.labels)) : new Map();
  let judge = null;
  if (options.judge) {
    const preliminary = input.pairs.map((pair) => evaluatePair(pair));
    judge = await judgePairs(preliminary, options);
    labels = labelsFromReview(judge);
  }
  const evaluations = input.pairs.map((pair) => {
    const baseline = evaluatePair(pair);
    return evaluatePair(pair, labels.get(baseline.pairId) ?? {});
  });
  const review = {
    rubricVersion: RUBRIC_VERSION,
    source: input.source,
    judge: judge?.judge ?? null,
    pairs: evaluations.map((episode) => ({
      pairId: episode.pairId,
      episode: episode.episode,
      firstSnapshotId: episode.firstId,
      finalSnapshotId: episode.finalId,
      changes: episode.changes.filter((change) => change.operation !== "unchanged"),
    })),
  };
  writeReports(outputDirectory, input, evaluations, review, judge);
  console.log(`Wrote ${evaluations.length} episode rows to ${outputDirectory}`);
  console.log(`Fit scores: ${evaluations.filter((episode) => episode.fitScore !== null).length} complete; ${evaluations.filter((episode) => episode.fitScore === null).length} pending labels`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { loadDatabasePairs };
