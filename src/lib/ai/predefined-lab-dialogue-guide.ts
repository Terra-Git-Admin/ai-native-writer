import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";

export const PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID = "predefined_lab_dialogue_quality_guide";
export const PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK_PROMPT_ID = "predefined_lab_dialogue_reference_pack";

export const DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE = `Use this as hidden dialogue craft calibration, not visible output.

Good microdrama dialogue is compressed, playable, and pressure-bearing.

Prioritize:
- short exchanges where each line changes the power dynamic
- subtext: characters protect, test, accuse, deflect, or reveal without explaining feelings
- continuity-aware voice from the selected previous predefined episodes
- interruption, silence, evasion, and physical behavior when speech would over-explain
- lines that reveal what a character wants, knows, hides, fears, or refuses to admit

Avoid:
- generic greetings and repeated reactions
- explaining emotions already visible in action
- adding new story events during a dialogue polish pass
- copying character voice, premise, or scene pattern from external reference material`;

export const DEFAULT_PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK = `Use this as hidden craft calibration, not story context.

Reference sources: Nurse and Ring dialogue exports, plus microdrama dialogue-engineering principles. These are different series. Never copy their names, premises, settings, relationships, exact lines, or plot situations.

Reusable patterns:
- Dialogue is action: every line should try to make someone believe, submit, expose, stop, come closer, leave, commit, lose face, or change tactics.
- Track line function before line beauty: attack, evade, probe, entice, threaten, bargain, deny, deflect, name, set a limit, assert status, demand confirmation.
- Conflict is not two people saying opposite facts. Strong exchanges use different frames to fight over the same outcome.
- Status lives in sentence form: commands, naming, address, silence, permission to end a topic, over-explaining, politeness, or who gets to define the subject.
- Subtext needs cost: a character says the substitute phrase because saying the real want directly would risk pride, safety, leverage, love, or status.
- Exposition must be used as a weapon, proof, contradiction, bargain, or trap. Do not let the author speak through the character.
- Short lines are not chopped prose. Commands and counterattacks can be short; concealment, seduction, and bargaining can run longer.
- Silence only works when the audience knows why the character cannot or will not speak.
- V.O. should create pressure or reveal a private contradiction, not repeat visible emotion.
- With names removed, important lines should still feel tied to a specific character's language algorithm.

Positive calibration:
- Nurse often works because Yuki's clipped professional control collides with Hiro's flirtation under danger. Their lines do more than exchange facts: he tests intimacy while dying; she uses medical commands to keep control; the joke becomes a survival tether.
- Ring should be mined for status, withheld truth, and relationship-contract pressure: strong lines change who has leverage, what can be denied, or what the listener is forced to answer.

Dialogue Design should output scene pressure, tactics, secrets, line functions, and a few line anchors. It should not write the full final script or imitate the references.`;

export async function getActivePredefinedLabDialogueGuide(): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID),
  });
  return row?.content.trim() || DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE;
}

export async function getActivePredefinedLabDialogueReferencePack(): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK_PROMPT_ID),
  });
  return row?.content.trim() || DEFAULT_PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK;
}
