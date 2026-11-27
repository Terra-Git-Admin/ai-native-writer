import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildBulkPreview, parseEpisodeSections } from "../src/lib/predefined-bulk/catalog.ts";

function text(value) {
  return { type: "text", text: value };
}

function heading(value, uid) {
  return { type: "heading", attrs: { level: 3, ...(uid ? { anwSectionUid: uid } : {}) }, content: [text(value)] };
}

function paragraph(value) {
  return { type: "paragraph", content: [text(value)] };
}

function doc(nodes) {
  return JSON.stringify({ type: "doc", content: nodes });
}

const plots = doc([
  heading("Episode 1: Existing", "plot-1"), paragraph("The story is already scripted."),
  heading("Episode 2: Missing", "plot-2"), paragraph("A written plot with a reversal and cliffhanger."),
  heading("Episode 3: Empty", "plot-3"),
  heading("Episode 4: Later Gap", "plot-4"), paragraph("Another written plot after a gap."),
]);
const predefined = doc([
  heading("Episode 1: Existing", "predef-1"), paragraph("Seq 1 — Cafe | Day | Mina"), paragraph("(Visual: Mina works.)"),
]);

const sections = parseEpisodeSections(plots);
assert.deepEqual(sections.map((section) => section.episodeNumber), [1, 2, 4], "Only written plot bodies should be eligible catalog entries.");
assert.equal(sections[1].sectionUid, "plot-2");

const preview = buildBulkPreview(plots, predefined);
assert.deepEqual(preview.eligible.map((section) => section.episodeNumber), [2, 4]);
assert.deepEqual(preview.skipped.map((section) => section.episodeNumber), [1]);
assert.deepEqual(preview.issues, []);
assert.equal(preview.planHash.length, 64);

const duplicate = buildBulkPreview(
  doc([heading("Episode 2: A"), paragraph("First."), heading("Episode 2: B"), paragraph("Second.")]),
  null,
);
assert.match(duplicate.issues.join(" "), /Duplicate Microdrama Plot episode numbers: 2/);

const malformed = buildBulkPreview(doc([paragraph("A plot without an episode heading.")]), null);
assert.match(malformed.issues.join(" "), /no numbered episode headings/i);

const service = await readFile(new URL("../src/lib/predefined-bulk/service.ts", import.meta.url), "utf8");
const workspace = await readFile(new URL("../src/components/labs/PredefinedBulkWorkspace.tsx", import.meta.url), "utf8");
const stageWorkspace = await readFile(new URL("../src/components/labs/PredefinedLabStageWorkspace.tsx", import.meta.url), "utf8");
const editRoute = await readFile(new URL("../src/app/api/ai/edit/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0018_glorious_king_cobra.sql", import.meta.url), "utf8");

assert.match(service, /previousEpisodePolicy: "all_earlier"/);
assert.match(service, /predef_lab_beats[\s\S]*predef_lab_dialogue_design[\s\S]*predef_lab_draft/);
assert.match(service, /captureTextSnapshot/);
assert.match(service, /capturePredefinedTiptapSnapshots/);
assert.match(service, /SOURCE_CHANGED/);
assert.match(service, /status: "paused"/);
assert.match(service, /onError: \(\{ error \}\)/, "Streaming provider failures must be captured instead of becoming empty-output errors.");
assert.match(service, /API key is invalid\. Update it in Admin Settings/, "Invalid Gemini credentials must produce an actionable paused-run message.");
assert.match(workspace, /Generate missing episodes/);
assert.match(workspace, /role="status" aria-atomic="true"/);
assert.match(workspace, /Retry episode/);
assert.match(workspace, /Stop bulk generation/);
assert.match(stageWorkspace, /Single episode/);
assert.match(stageWorkspace, /Bulk generate/);
assert.match(editRoute, /PREDEFINED_BULK_ACTIVE/);
assert.match(migration, /CREATE TABLE `predefined_bulk_runs`/);
assert.match(migration, /CREATE TABLE `predefined_bulk_run_items`/);
assert.doesNotMatch(migration, /CREATE TABLE `ad_/);
assert.doesNotMatch(migration, /ALTER TABLE `plot_lab_/);

console.log("Predefined bulk generation regression checks passed.");
