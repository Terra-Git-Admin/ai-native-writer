import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const includes = (source, value, message) => assert.ok(source.includes(value), message);
const excludes = (source, value, message) => assert.ok(!source.includes(value), message);

const [
  sidebar,
  documentPage,
  editRoute,
  jobsRoute,
  applyRoute,
  promptsRoute,
  seedPrompts,
  prompts,
] = await Promise.all([
  read("src/components/ai/AIChatSidebar.tsx"),
  read("src/app/doc/[id]/page.tsx"),
  read("src/app/api/ai/edit/route.ts"),
  read("src/app/api/ai/jobs/route.ts"),
  read("src/app/api/ai/jobs/[id]/apply/route.ts"),
  read("src/app/api/prompts/route.ts"),
  read("src/lib/ai/seed-prompts.ts"),
  read("src/lib/ai/prompts.ts"),
]);
const chatPrompt = prompts.slice(
  prompts.indexOf("export const CHAT_SYSTEM_PROMPT"),
  prompts.indexOf("// ───", prompts.indexOf("export const CHAT_SYSTEM_PROMPT") + 1)
);

includes(sidebar, 'tabType === "microdrama_plots"', "Plots should have contextual Assistant guidance.");
includes(sidebar, 'tabType === "predefined_episodes"', "Predefined Episodes should have contextual Assistant guidance.");
includes(sidebar, 'tabType === "characters"', "Characters should have contextual Assistant guidance.");
includes(sidebar, "Open Predefined Lab", "Predefined Episodes should link to Predefined Lab.");
includes(sidebar, "Add Character", "Characters should retain the Add Character action.");
includes(sidebar, 'placeholder={plotLabActive ? "Chat with Levi..." : "What would you like to do?"}', "Chat composer should remain available.");
includes(sidebar, 'disabled={isStreaming || !input.trim()}', "Sending should not depend on character profiles.");
excludes(sidebar.toLowerCase(), "questionnaire", "The retired questionnaire should not appear in the Assistant UI.");
excludes(sidebar, 'handleStartJob("next_reference_episode")', "Assistant should not create predefined episodes through the legacy job action.");

includes(documentPage, "onOpenPredefinedLab={handleOpenPredefinedLab}", "Assistant should use the page-level Predefined Lab handoff.");
includes(documentPage, "setAiSidebarOpen(false)", "Successful Predefined Lab handoff should close the Assistant.");

excludes(editRoute, "getCharacterQuestionnaireStatus", "Chat/edit modes should not query questionnaire status.");
excludes(editRoute, "CHARACTER_QUESTIONNAIRE_INCOMPLETE", "Chat/edit modes should not be questionnaire-gated.");

includes(jobsRoute, 'promptKind === "prepare_character_questionnaire"', "Legacy questionnaire job creation should be recognized.");
includes(jobsRoute, "status: 410", "Legacy questionnaire job creation should return Gone.");
excludes(jobsRoute, '"prepare_character_questionnaire",\n]);', "The questionnaire should not be an active job kind.");
excludes(jobsRoute, "PERSONA_DEPENDENT_KINDS", "Predefined episode jobs should not be character-profile gated.");
includes(applyRoute, 'job.promptKind === "prepare_character_questionnaire"', "Historical questionnaire jobs should be recognized during apply.");
includes(applyRoute, "status: 410", "Historical questionnaire jobs should not apply.");

includes(promptsRoute, 'new Set(["prepare_character_questionnaire"])', "Retired prompts should be centrally filtered.");
includes(promptsRoute, "!RETIRED_PROMPT_IDS.has(row.id)", "Retired prompts should be hidden from all prompt lists.");
includes(promptsRoute, "status: 410", "Retired prompts should not be updateable.");
excludes(seedPrompts, 'id: "prepare_character_questionnaire"', "Retired questionnaire prompt should not be seeded.");
includes(seedPrompts, 'label: "Chat Mode v1.1"', "The revised chat prompt should carry a new version label.");

includes(prompts, "Chat Mode prompt v1.1", "Chat prompt should document its version.");
includes(prompts, "2026-11-11", "Chat prompt should include the dated changelog entry.");
includes(chatPrompt, "The Characters tab is authoritative for any completed character profiles.", "Completed Character profiles should remain authoritative.");
includes(chatPrompt, "Microdrama Plots, Predefined Episodes, and Original Research", "Incomplete Characters should fall back to established story context.");
includes(chatPrompt, "clearly label them as proposals", "New fictional details should be identified as proposals.");
excludes(chatPrompt, "use only the names from the Characters tab. Never use the name of any real person", "Chat should no longer require names to originate in Characters.");

console.log("AI Assistant regression checks passed.");
