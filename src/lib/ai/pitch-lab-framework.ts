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
export const DEFAULT_PITCH_LAB_TASTE_BRIEF = `Create pitchable Episode 1 plots for vertical microdrama series. Use this as hidden taste direction, not visible output.

Prioritize:
- a concrete opening incident already in motion
- a heroine who reveals herself through action under pressure
- a male lead whose authority, danger, status, or competence is shown by how the world reacts to him
- one memorable physical object, mistake, public pressure, danger, or deadline
- forced future contact that means the leads cannot simply walk away
- a concrete final turn or freeze-frame that pulls Episode 2

Write each idea so a reader can immediately picture the people and place. Weave in light visual cues naturally: approximate age range, outward image or dressing, social role, and one distinctive location detail. Do not pause the plot for casting notes.

Use the spirit of these calibration examples: wrong-table proposal, journalist scandal to fake relationship, farm girl crashes into a Manhattan interview, nurse saves a dangerous patient, bank teller bomb vest. They are examples of pressure, character action, chemistry, visual clarity, and forced contact; do not copy their exact premises.

Avoid:
- visible framework language, signal names, scores, trope labels, or explanations of fit
- generic meet-cutes, generic CEOs, generic gangsters, or prestige/status labels without simple scene pressure
- long backstory setup before the first incident
- worksheet fields like hook, beats, tick logic, or world-clash ending`;

export async function getActivePitchLabFramework(): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, PITCH_LAB_TASTE_BRIEF_PROMPT_ID),
  });
  return row?.content.trim() || DEFAULT_PITCH_LAB_TASTE_BRIEF;
}
