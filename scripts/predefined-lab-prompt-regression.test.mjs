import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const prompts = await readFile(new URL("../src/lib/ai/prompts.ts", import.meta.url), "utf8");
const seeds = await readFile(new URL("../src/lib/ai/seed-prompts.ts", import.meta.url), "utf8");
const workspace = await readFile(new URL("../src/components/labs/PredefinedLabStageWorkspace.tsx", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/lib/ai/predefined-lab-runtime.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/ai/edit/route.ts", import.meta.url), "utf8");
const guide = await readFile(new URL("../src/lib/ai/predefined-lab-dialogue-guide.ts", import.meta.url), "utf8");

function block(name, nextHeading) {
  const start = prompts.indexOf(`export const ${name}`);
  const end = prompts.indexOf(nextHeading, start);
  assert.ok(start >= 0 && end > start, `${name} block should be extractable`);
  return prompts.slice(start, end);
}

const beats = block("PREDEFINED_LAB_BEATS_PROMPT", "// Ad Lab pipeline prompts");
const draft = block("PREDEFINED_LAB_DRAFT_PROMPT", "// Predefined Lab Dialogue Design prompt");
const dialogue = block("PREDEFINED_LAB_DIALOGUE_DESIGN_PROMPT", "// Predefined Lab Iterate prompt");
const iterate = block("PREDEFINED_LAB_ITERATE_PROMPT", "// Predefined Lab Dialogue Pass prompt");
const dialoguePass = block("PREDEFINED_LAB_DIALOGUE_PASS_PROMPT", "// ─── Entity Extraction");

assert.match(beats, /beat planner v1\.2/);
assert.match(beats, /Every scene begins already in motion/);
assert.match(beats, /Active business/);
assert.match(beats, /stimulus, involuntary response, attempted control/);
assert.match(beats, /setting-native props/);

assert.match(dialogue, /dialogue designer v1\.6/);
assert.match(dialogue, /Human response-chain design/);
assert.match(dialogue, /Dialogue count is secondary/);
assert.match(dialogue, /Listener Reveal/);
assert.match(dialogue, /Notice \/ Adjustment/);
assert.match(dialogue, /Human Texture/);
assert.match(dialogue, /Do not name an unnamed character/);
assert.match(dialogue, /default to zero V\.O\./);
assert.match(dialogue, /turn concern into blame/);
assert.match(dialogue, /silent gesture or action-only response stays nonverbal/);
assert.match(dialogue, /Preserve specificity boundaries/);
assert.match(dialogue, /Never propose a bracketed placeholder/);
assert.doesNotMatch(dialogue, /Source Speech Ledger/);

assert.match(draft, /episode writer v1\.4/);
assert.match(draft, /No character waits neutrally/);
assert.match(draft, /setting-native props/);
assert.match(draft, /slight extension allowed/);
assert.match(draft, /stimulus, involuntary response, attempted control/);
assert.match(draft, /dialogue sounds lived rather than summarized/);
assert.match(draft, /Keep an unnamed character under the source role label/);
assert.match(draft, /default to zero V\.O\./);
assert.match(draft, /protective concern into accusation/);
assert.match(draft, /Never turn a silent gesture/);
assert.match(draft, /Keep qualitative wording qualitative/);
assert.match(draft, /Never emit a planning placeholder/);
assert.match(draft, /Dialogue Design cannot authorize V\.O\. by itself/);
assert.match(draft, /calendar, note, sign, document, or screen/);
assert.doesNotMatch(draft, /closed Source Speech Ledger/);

assert.match(iterate, /draft reviser v1\.3/);
assert.match(iterate, /replace neutral waiting/);
assert.match(iterate, /Preserve approximate duration, not a dialogue quota/);

assert.match(dialoguePass, /dialogue editor v1\.3/);
assert.match(dialoguePass, /No character waits neutrally/);
assert.match(dialoguePass, /listener reveal something visible/);

assert.match(runtime, /Locked Plot Intent:/);
assert.match(runtime, /Permitted Dramatization:/);
assert.match(runtime, /Begin every scene already in motion/);
assert.match(runtime, /Dialogue count is secondary/);
assert.match(runtime, /Do not name an unnamed character/);
assert.match(runtime, /silent gesture or nonverbal response stays nonverbal/);
assert.match(runtime, /Preserve specificity boundaries/);
assert.match(workspace, /buildPredefinedLabContext/);

assert.match(guide, /Dialogue Quality Guide v1\.1/);
assert.match(guide, /56 paired first-generation and editor-final episodes/);
assert.match(guide, /listener's microreaction changes the speaker's next tactic/);

assert.match(route, /PREDEFINED_LAB_PERFORMANCE_GUIDE_MODES/);
assert.match(route, /## Final-Export Performance Guide/);

assert.match(seeds, /Predefined Lab: Build Key Beats v1\.2/);
assert.match(seeds, /Predefined Lab: Dialogue Design v1\.6/);
assert.match(seeds, /Predefined Lab: Write Episode Draft v1\.4/);
assert.match(seeds, /Predefined Lab: Iterate Draft v1\.3/);
assert.match(seeds, /Predefined Lab: Dialogue Pass v1\.3/);

console.log("Predefined Lab prompt regression checks passed.");
