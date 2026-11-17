import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { composePromptForOrientation } from "../src/lib/ai/content-profile.ts";

const base = "PORTRAIT BASE PROMPT";

assert.equal(
  composePromptForOrientation(base, "next_reference_episode", "portrait"),
  base,
  "portrait prompts must remain byte-for-byte unchanged"
);

const landscapePlot = composePromptForOrientation(base, "plot_lab_chat", "landscape");
assert.ok(landscapePlot.startsWith(base), "landscape must preserve the selected base prompt");
assert.match(landscapePlot, /roughly 2 minutes/i);
assert.match(landscapePlot, /Four or five sequential milestones/i);
assert.match(landscapePlot, /8-10 minute chapter/i);
assert.match(landscapePlot, /does not need an artificial cliffhanger/i);
assert.match(landscapePlot, /chapter-end monetization turn/i);
assert.match(landscapePlot, /interpret E2-E5 as milestones 2-5/i);
assert.match(landscapePlot, /Do not invent, store, or emit chapter metadata/i);
assert.match(landscapePlot, /override conflicting portrait or microdrama pacing rules/i);

const landscapeScript = composePromptForOrientation(base, "next_reference_episode", "landscape");
assert.match(landscapeScript, /cinematic landscape frame/i);
assert.match(landscapeScript, /foreground\/midground\/background/i);
assert.match(landscapeScript, /Seq \/ Visual \/ Dialogue \/ V\.O\./i);
assert.match(landscapeScript, /Do not add camera jargon or shot lists/i);

const landscapeEvaluation = composePromptForOrientation(base, "feedback", "landscape");
assert.match(landscapeEvaluation, /chapter-level escalation/i);
assert.match(landscapeEvaluation, /Do not penalize.*portrait dialogue caps/i);

const schema = await readFile(new URL("../src/lib/db/schema.ts", import.meta.url), "utf8");
assert.match(schema, /orientation: text\("orientation".*\["portrait", "landscape"\]/s);
assert.match(schema, /\.default\("portrait"\)/);

const jobs = await readFile(new URL("../src/lib/ai/jobs.ts", import.meta.url), "utf8");
assert.match(jobs, /next_reference_episode" && orientation === "portrait"/);
assert.match(jobs, /contentProfileContractVersion/);

const seedPrompts = await readFile(new URL("../src/lib/ai/seed-prompts.ts", import.meta.url), "utf8");
assert.doesNotMatch(seedPrompts, /id:\s*["']landscape_/i, "landscape must not create duplicate prompt IDs");

const writerExport = await readFile(new URL("../src/lib/export/writer-export.ts", import.meta.url), "utf8");
const writerExportInterface = writerExport.match(/export interface WriterExport \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.doesNotMatch(writerExportInterface, /orientation/, "Writer Export v2 shape must remain unchanged");

console.log("Content profile regression checks passed.");
