import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";

export const PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID = "predefined_lab_dialogue_quality_guide";

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

export async function getActivePredefinedLabDialogueGuide(): Promise<string> {
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID),
  });
  return row?.content.trim() || DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE;
}
