import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";

export const PITCH_LAB_TASTE_BRIEF_PROMPT_ID = "pitch_lab_taste_brief";

/**
 * Server-side source for the active Pitch Lab taste brief.
 *
 * This is intentionally stored as a non-seeded prompts row. System prompts are
 * reseeded from code on boot, but the taste brief is an admin-owned calibration
 * note and must survive restarts until an admin edits it again.
 */
// Pitch Lab taste brief version 1.3, updated 2026-10-12.
// Changelog 2026-10-12: preserve historic/fantasy/royal/archetypal world cues instead of modernizing them into professions or urban locations.
// Changelog 2026-10-12: keep visible language as ideas, require profile tension in idea cards, and avoid episode-framing before Studio.
// Changelog 2026-10-12: make calibration stage-aware so ideas are broad selectable concepts, routes defer situation mechanics, and concrete pressure belongs to Studio.
export const DEFAULT_PITCH_LAB_TASTE_BRIEF = `Create pitchable vertical microdrama series material. Use this as hidden taste direction, not visible output.

Prioritize:
- a clear idea before any exact Episode 1 mechanism is chosen
- a heroine whose capability, vulnerability, status pressure, or moral pressure can generate many routes
- an opposing lead or force whose authority, danger, status, or competence creates recurring emotional charge
- visible woman/opposing-lead profile tension in idea cards, without locking a scene
- world/time fidelity: if the writer gives royal, historical, fantasy, mythic, hunter, warrior, palace, clan, forest, kingdom, or similar cues, keep those as the actual story world unless a modern adaptation is explicitly requested
- a commercial relationship engine: bargain, belief gap, forbidden alliance, status reversal, public image, family pressure, danger, justice, rescue, or revenge
- route-level choices that feel distinct without fixing a specific opening incident
- concrete scene pressure, proof objects, public reactions, and Episode 2 turns only when Studio is asked to develop a selected route

At the idea stage, write broad selectable ideas with lead/counterlead tension. Do not describe what episodes do. At the pitch-route stage, describe different delivery paths for the selected idea. At Studio, close the exact Episode 1 situation with visible action, pressure, consequence, and next-scene obligation.

Use the spirit of high-conversion microdrama: fast relational clarity, asymmetrical power, public stakes, heroine agency, and a turn that makes the next episode necessary. Do not copy calibration premises or force every story into physical proximity.

Avoid:
- visible framework language, signal names, scores, trope labels, or explanations of fit
- generic meet-cutes, generic CEOs, generic gangsters, or prestige/status labels without simple scene pressure
- random modern locations or professions when the input implies a historical, royal, fantasy, mythic, or archetypal world
- turning princess, hunter, warrior, noble, healer, guard, or similar roles into modern disguises unless the writer asks for disguise or modern AU
- long backstory setup before the first idea or route becomes legible
- episode-framing phrases like "each episode", "episodes promise", "episodes deliver", "series arc", or "season"
- worksheet fields like hook, beats, tick logic, or world-clash ending`;

export async function getActivePitchLabFramework(): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, PITCH_LAB_TASTE_BRIEF_PROMPT_ID),
  });
  return row?.content.trim() || DEFAULT_PITCH_LAB_TASTE_BRIEF;
}
