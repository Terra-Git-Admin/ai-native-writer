import assert from "node:assert/strict";
import { getPitchLabContentState } from "../src/lib/ai/pitch-lab-content-contract";
import { serializePitchIdeaEnvelope } from "../src/lib/pitch-lab-idea-envelope";

const episode = "She flees her wedding into his hotel. The new owner spots her engagement ring and closes the door before her family arrives.";
const envelope = serializePitchIdeaEnvelope({ originalText: episode, currentText: episode, contentKind: "episode_pilot", turns: [] });
assert.deepEqual(getPitchLabContentState("generated", envelope).isValid, true);
assert.deepEqual(getPitchLabContentState("shortlisted", envelope).isValid, true);
assert.deepEqual(getPitchLabContentState("promoted", envelope).isValid, true);

const old = serializePitchIdeaEnvelope({ originalText: episode, currentText: episode, contentKind: "pilot_option", turns: [] });
assert.equal(getPitchLabContentState("generated", old).isValid, false);
console.log("Episode pilot content contract passed.");
