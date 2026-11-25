import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocalAdDraft, selectAdLabModelId, shouldConfirmNewAd, validateAdDraft } from "../src/lib/ad-lab.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sample = buildLocalAdDraft("Hook Ad", "Mira finds the letter under the door.");

assert.equal(validateAdDraft(sample).ok, true);
assert.equal(validateAdDraft(sample.replace("B — EXISTING FOOTAGE", "B — NEW CLIP")).ok, false);
assert.match(sample, /\[P\] A — NEW CLIP[\s\S]*\[P\] B — EXISTING FOOTAGE[\s\S]*\[P\] C — NEW CLIP[\s\S]*\[P\] D — EXISTING FOOTAGE/);
assert.equal((sample.match(/\(Source Footage:/g) ?? []).length, 2);
assert.equal(selectAdLabModelId([{ id: "gpt-5.2" }], "local-sample"), "gpt-5.2");
assert.equal(selectAdLabModelId([{ id: "gpt-5.2" }, { id: "gemini-3.1-pro-preview" }], "gemini-3.1-pro-preview"), "gemini-3.1-pro-preview");
assert.equal(selectAdLabModelId([{ id: "gemini-thinking", thinking: true }], ""), "local-sample");
assert.equal(selectAdLabModelId([], ""), "local-sample");
assert.equal(shouldConfirmNewAd({ running: false, hasInput: false, hasDraft: false, hasFeedback: false, savedCurrentDraft: false }), false);
assert.equal(shouldConfirmNewAd({ running: false, hasInput: true, hasDraft: false, hasFeedback: false, savedCurrentDraft: false }), true);
assert.equal(shouldConfirmNewAd({ running: true, hasInput: false, hasDraft: false, hasFeedback: false, savedCurrentDraft: false }), true);
assert.equal(shouldConfirmNewAd({ running: false, hasInput: true, hasDraft: true, hasFeedback: false, savedCurrentDraft: true }), false);
assert.equal(shouldConfirmNewAd({ running: false, hasInput: true, hasDraft: true, hasFeedback: true, savedCurrentDraft: true }), true);

const canonical = read("src/lib/canonical-tabs.ts");
assert.match(canonical, /CURRENT_CANONICAL_TABS_VERSION = 4/);
assert.match(canonical, /type: "ads",[\s\S]*title: "Ads",[\s\S]*position: 6/);

const schema = read("src/lib/db/schema.ts");
assert.doesNotMatch(schema, /adDocuments|ad_projects|ad_artifacts/);
assert.equal(fs.existsSync(path.join(root, "src/app/ad-lab/page.tsx")), false);

const workspace = read("src/components/labs/AdLabWorkspace.tsx");
const documentPage = read("src/app/doc/[id]/page.tsx");
const adLabDocs = read("docs/ad-lab.md");
assert.match(workspace, /New Ad/);
assert.match(workspace, /Generate Draft/);
assert.match(workspace, /Save to Ads/);
assert.match(workspace, /Give Feedback/);
assert.match(workspace, /Previous versions/);
assert.match(workspace, /new AbortController\(\)/);
assert.match(workspace, /sessionRef\.current \+= 1/);
assert.doesNotMatch(workspace, /ad_lab_beats/);
assert.doesNotMatch(workspace, /ad_lab_dialogue_design/);
assert.doesNotMatch(workspace, /Auto-run to Draft/);
assert.doesNotMatch(workspace, />Audit/);
assert.doesNotMatch(workspace, />Dialogue Pass</);
assert.match(adLabDocs, /moves directly from the inputs to a complete A–B–C–D draft/);
assert.doesNotMatch(adLabDocs, /Communication Design → Draft/);
assert.match(workspace, /versionReason: "ad-lab-save"/);
assert.match(workspace, /response\.status === 409/);
assert.match(
  documentPage,
  /setSelectedModelId\(selectAdLabModelId\(aiModels, selectedModelId\)\)/,
  "Ad Lab must use a configured non-thinking model before falling back to local sample mode."
);
assert.match(read("src/app/api/documents/[id]/tabs/[tabId]/content/route.ts"), /versionReason === "ad-lab-save"/);

const prompts = read("src/lib/ai/prompts.ts");
for (const name of ["AD_LAB_BEATS_PROMPT", "AD_LAB_DIALOGUE_DESIGN_PROMPT", "AD_LAB_DRAFT_PROMPT", "AD_LAB_ITERATE_PROMPT", "AD_LAB_DIALOGUE_PASS_PROMPT"]) assert.match(prompts, new RegExp(name));
assert.match(prompts, /B and D are existing series footage/);
assert.match(prompts, /Ad Lab draft writer v1\.1/);
assert.match(prompts, /listicle or progressive reveal/);
assert.match(prompts, /screenlife or text-message conversation/);
assert.match(prompts, /Preserve its creative device and execution pattern/);
assert.match(prompts, /Do not emit planning notes, pattern names, audit notes, or process commentary/);
assert.match(read("src/lib/ai/seed-prompts.ts"), /Ad Lab: Write Draft v1\.1/);

const exportRoute = read("src/app/api/documents/[id]/export/route.ts");
assert.match(exportRoute, /scope === "ads"/);
assert.match(read("src/lib/export/ads-export.ts"), /documentType: "ads"/);

console.log("Series-native Ad Lab regression contract: PASS");
