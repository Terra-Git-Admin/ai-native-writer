import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";

export const PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID = "predefined_lab_dialogue_quality_guide";
export const PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK_PROMPT_ID = "predefined_lab_dialogue_reference_pack";

// Predefined Lab Dialogue Quality Guide v1.1
// Changelog:
// - 2026-11-27: Ground dialogue in active business, listener response, and human imperfection learned from 56 plot-to-first-to-final lineage triples.
export const DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE = `Predefined Lab Dialogue Quality Guide v1.1. Use this as hidden dialogue craft calibration, not visible output.

Good microdrama dialogue is compressed, playable, and pressure-bearing.

Prioritize:
- short exchanges where each line changes the power dynamic
- subtext: characters protect, test, accuse, deflect, or reveal without explaining feelings
- continuity-aware voice from the selected previous predefined episodes
- interruption, silence, evasion, and physical behavior when speech would over-explain
- lines that reveal what a character wants, knows, hides, fears, or refuses to admit
- visible human reactions before or between important lines
- response chains: the listener reveals something physically, and the next line changes because the speaker notices or misses it
- active business: nobody waits neutrally for dialogue; speech collides with work, escape, concealment, observation, recovery, or preparation already underway
- setting-native props and blocking that externalize existing emotion, status, decision, or relationship without creating a new plot fact
- human imperfection: self-correction, unfinished thoughts, rambling cut short by observation, delayed answers, indirect objections, practical questions hiding emotional stakes, teasing, politeness, and loss of verbal control
- correct emotion target: panic, anger, affection, fear, and contempt should be aimed at the right person or threat
- identity fidelity: retain source names and role labels; never invent a name for an unnamed character or turn bewildered/protective concern into accusation
- specificity fidelity: never invent or concretize names, amounts, currencies, dates, deadlines, appointments, messages, addresses, or written labels that the source leaves vague
- placeholder discipline: never emit [amount], [name], [sum], or another planning token; phrase the source's vagueness naturally without filling the missing fact
- identity through behavior, speech rhythm, restraint, status, and what the character refuses to say

Avoid:
- generic greetings and repeated reactions
- explaining emotions already visible in action
- adding new story events during a dialogue polish pass
- turning urgency with allies into hostility unless the source explicitly supports it
- packing several plot facts into one line just to satisfy a dialogue count
- treating compression as the goal; a line may grow or shrink according to character, relationship, and pressure
- dialogue that proceeds unchanged after a listener visibly recoils, freezes, withdraws, reaches out, or looks away
- V.O. that narrates an immediate goal, command, fear, recognition, or reaction already visible on screen; default to zero V.O. when prior episodes do not establish a narrator
- props or screen text that smuggle in a new appointment, deadline, amount, message, or factual event
- copying character voice, premise, or scene pattern from external reference material`;

// Predefined Lab Dialogue Reference Pack v1.1
// Changelog:
// - 2026-11-27: Make editor-final exports the primary taste source and encode observed plot-to-performance transformations.
export const DEFAULT_PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK = `Predefined Lab Dialogue Reference Pack v1.1. Use this as hidden craft calibration, not story context.

Primary calibration: 56 paired first-generation and editor-final episodes from Florist, Prince, Lift, and Vampire Camera. The recurring editorial move is not uniformly shorter or longer dialogue. It is dialogue made more embodied, relational, interruptible, and responsive to visible behavior. Never copy names, premises, settings, relationships, exact lines, or plot situations.

Observed final-export transformations:
- A neutral setup becomes active business already underway; the arriving character interrupts life rather than starting the scene.
- A plot summary becomes a concrete social tactic: offer, refusal, deflection, boundary, command, probe, tease, or partial admission.
- A composed sentence becomes damaged by pressure through hesitation, repetition, self-correction, interruption, or failure to finish.
- A generic objection becomes relationship-specific: status address, shared shorthand, a practical question hiding fear, or a boundary only this pair would use.
- A listener's microreaction changes the speaker's next tactic instead of serving as decorative acting.
- A setting-native prop gives hands truthful work and carries an existing emotion or decision without creating a new causal fact.
- Explanatory V.O. becomes visible reception when the body, prop, distance, or silence can carry the meaning.
- Informational transit is compressed while discovery, decision, power reversal, and emotional consequence are allowed to breathe.

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

Secondary positive calibration:
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
