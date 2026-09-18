/**
 * Server-side source for the active Pitch Lab framework.
 *
 * Keep this behind an async resolver so it can be replaced with the central
 * brain framework endpoint when that service is available. Never return this
 * content to the browser.
 */
const PACKAGED_PITCH_LAB_FRAMEWORK = `Create pitchable EP1 plots for vertical microdrama series. Every idea should open on a vivid, quickly understood pressure situation; create a strong relationship or opposition engine through the crisis; include a reversal or reveal that changes how the setup is understood; and end on a clear next-episode pull. Keep each premise concrete, emotionally legible, and distinct in protagonist situation, relationship dynamic, reveal, and cliffhanger. Write the idea as a direct, compact plot paragraph in plain language, in the spirit and level of detail of this example: "A hot bank teller has a bomb vest on. An easygoing male lead cop is trying to defuse it. She is panicking so much that the vest is shaking and he cannot get the right wire. He starts flirting with her. She is taken aback and holds still, so he can focus. They flirt and talk. He defuses the vest. She laugh-cries in relief. Suddenly the vest starts beeping again. He goes, oh shit." Do not turn the plot into separate hook, relationship, or cliffhanger fields. Do not show ratings, evaluation, framework signal names, or explanations of fit.`;

export async function getActivePitchLabFramework(): Promise<string> {
  // The central brain API does not exist yet; use the packaged framework.
  return PACKAGED_PITCH_LAB_FRAMEWORK;
}
