import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocalAdDraft, validateAdDraft } from "../src/lib/ad-lab.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sample = buildLocalAdDraft("Hook Ad", "Mira finds the letter under the door.");

assert.equal(validateAdDraft(sample).ok, true);
assert.equal(validateAdDraft(sample.replace("B — EXISTING FOOTAGE", "B — NEW CLIP")).ok, false);
assert.match(sample, /\[P\] A — NEW CLIP[\s\S]*\[P\] B — EXISTING FOOTAGE[\s\S]*\[P\] C — NEW CLIP[\s\S]*\[P\] D — EXISTING FOOTAGE/);
assert.equal((sample.match(/\(Source Footage:/g) ?? []).length, 2);

const canonical = read("src/lib/canonical-tabs.ts");
assert.match(canonical, /CURRENT_CANONICAL_TABS_VERSION = 4/);
assert.match(canonical, /type: "ads",[\s\S]*title: "Ads",[\s\S]*position: 6/);

const schema = read("src/lib/db/schema.ts");
assert.doesNotMatch(schema, /adDocuments|ad_projects|ad_artifacts/);
assert.equal(fs.existsSync(path.join(root, "src/app/ad-lab/page.tsx")), false);

const workspace = read("src/components/labs/AdLabWorkspace.tsx");
assert.match(workspace, /A–B–C–D Structure/);
assert.match(workspace, /Communication Design/);
assert.match(workspace, /Save to Ads/);
assert.match(workspace, /Give Feedback/);
assert.match(workspace, /Approve Structure & Build Communication/);
assert.match(workspace, /Auto-run to Draft/);
assert.doesNotMatch(workspace, />Dialogue Pass</);
assert.match(workspace, />User</);
assert.match(workspace, /Rerun/);
assert.match(workspace, /Pipeline/);
assert.match(workspace, /versionReason: "ad-lab-save"/);
assert.match(workspace, /response\.status === 409/);
assert.match(read("src/app/api/documents/[id]/tabs/[tabId]/content/route.ts"), /versionReason === "ad-lab-save"/);

const prompts = read("src/lib/ai/prompts.ts");
for (const name of ["AD_LAB_BEATS_PROMPT", "AD_LAB_DIALOGUE_DESIGN_PROMPT", "AD_LAB_DRAFT_PROMPT", "AD_LAB_ITERATE_PROMPT", "AD_LAB_DIALOGUE_PASS_PROMPT"]) assert.match(prompts, new RegExp(name));
assert.match(prompts, /B and D are existing series footage/);

const exportRoute = read("src/app/api/documents/[id]/export/route.ts");
assert.match(exportRoute, /scope === "ads"/);
assert.match(read("src/lib/export/ads-export.ts"), /documentType: "ads"/);

console.log("Series-native Ad Lab regression contract: PASS");
