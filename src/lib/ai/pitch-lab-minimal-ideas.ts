// Pitch Lab minimal Idea experiment version 1.3, updated 2026-10-27.
// Changelog 2026-10-27 (1.3): regenerate a Fresh Idea batch against its current set while preserving the one-line generation contract.
// Changelog 2026-10-16 (1.2): make lead genders legible; title cards with a word from the generated idea.
// Changelog 2026-10-16: name the Episode 1 plot task and one-line output so a short writer seed does not elicit series summaries.
// Changelog 2026-10-16 (1.0): one-call Fresh Idea prompt with a frozen framework packet and free-form line output.
export const PITCH_LAB_MINIMAL_IDEA_PROMPT_VERSION = "1.3";

// Frozen from the Pitch Lab Taste Brief for the first Fresh comparison. These are
// inputs to the experiment, not output-shape rules or an automatic insight picker.
export const FRESH_IDEA_INSIGHTS = [
  "A heroine's capability or status pressure can drive her choices.",
  "An opposing lead's authority or competence can create emotional charge and shifting leverage.",
] as const;

export function buildMinimalFreshIdeaPrompt(brief: string, instruction: string): string {
  const writerInput = [brief, instruction].filter(Boolean).join("\n");
  return `Generate one-line ideas for possible Episode 1 microdrama plots. Use the insights below and the writer's direction. Make each lead's gender clear through names or gendered words. Return only the ideas.

Insights:
${FRESH_IDEA_INSIGHTS.join("\n")}

Writer instruction:
${writerInput}`;
}

export function buildMinimalFreshIdeaBatchRegenerationPrompt(brief: string, instruction: string, currentIdeas: string[]): string {
  const currentSet = currentIdeas.map((idea, index) => `${index + 1}. ${idea}`).join("\n");
  return `${buildMinimalFreshIdeaPrompt(brief, instruction)}

This is Regenerate all ideas. Replace the current set with a new set of possible Episode 1 plots. The latest writer instruction describes what should change; apply it across the new set. Use the current ideas to understand references such as "these ideas" and to avoid returning the same set with cosmetic edits. Do not rewrite each old idea one by one. Keep the original writer direction unless the latest instruction changes it.

Current ideas:
${currentSet || "None."}

Return one new idea per line, with no titles, JSON, explanations, or old-to-new mapping. If the writer specifies a count, follow it; otherwise return ${currentIdeas.length || "a useful number of"} ideas.`;
}

const HEADING_WORDS = new Set([
  "heiress", "surgeon", "spy", "princess", "hacker", "twin", "assassin",
  "bodyguard", "bride", "wife", "maid", "medic", "doctor", "nurse",
  "lawyer", "prosecutor", "detective", "appraiser", "designer", "forger",
  "actress", "queen", "rider", "mechanic", "secretary", "intern",
  "baker", "thief", "rebel", "scholar", "strategist", "pilot",
  "director", "general", "tycoon", "kingpin", "ceo", "artist",
]);

const HEADING_SKIP_WORDS = new Set([
  "about", "after", "against", "along", "already", "among", "around", "before",
  "behind", "being", "between", "brilliant", "caught", "desperate", "disgraced",
  "during", "elite", "family", "forced", "hiding", "immediately", "inside",
  "lowly", "must", "newest", "only", "posing", "pretend", "secretly",
  "their", "there", "these", "those", "under", "until", "while", "world",
]);

export function pickMinimalIdeaHeading(idea: string): string {
  const words = idea.match(/[\p{L}]+/gu) ?? [];
  const role = words.find((word) => HEADING_WORDS.has(word.toLowerCase()));
  const fallback = words.find((word) => word.length >= 5 && !HEADING_SKIP_WORDS.has(word.toLowerCase()));
  const word = role ?? fallback ?? words[0] ?? "Idea";
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function parseMinimalIdeaLines(text: string): string[] {
  const ideas = text.split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:\d+[.)]\s*|[-*]\s*)/, "").trim())
    .filter(Boolean);
  if (!ideas.length) throw new Error("Argon returned no Idea lines. Please generate again.");
  return ideas;
}
