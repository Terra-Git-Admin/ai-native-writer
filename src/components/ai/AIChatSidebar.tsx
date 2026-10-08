"use client";

import { useState, useRef, useEffect, useCallback, useMemo, RefObject } from "react";
import type { TabRow } from "@/components/editor/TabRail";
import type { EditorHandle } from "@/components/editor/Editor";
import { buildAIContext, buildPipelineStepContext, buildPlotLabContext, tiptapJsonToTagged } from "@/lib/ai/context-engine";
import { parseCharacterProfiles, normalizeCharacterName } from "@/lib/ai/characters";
import type { useJob, JobKind } from "@/lib/ai/useJob";
import { handleTextareaLineMoveKeyDown } from "@/lib/editing/line-move";
import { taggedTextToTiptapDoc } from "@/lib/editor/tagged-parser";
import { inferPlotLabDecisionSection } from "@/lib/plot-lab/workflow";

type AIJobController = ReturnType<typeof useJob>;

const JOB_LABELS: Partial<Record<JobKind, string>> = {
  next_reference_episode: "Create Pre-defined Episode",
  prepare_character_questionnaire: "Identify Major Cast",
};

// ─── Types ───

type Mode =
  | "edit" | "draft" | "feedback" | "format" | "chat"
  | "pipe_world_state" | "pipe_beat_gen" | "pipe_causality" | "pipe_plot_synth"
  | "pipe_continuation_state" | "pipe_continuation_beats" | "pipe_continuation_logic" | "pipe_continuation_synth"
  | "plot_lab_chat" | "plot_lab_save_preview" | "plot_lab_final_plot";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type HistoryEntry =
  | { type: "mode-change"; id?: string; mode: Mode; timestamp: number }
  | { type: "message"; id?: string; role: "user" | "assistant"; content: string; mode: Mode };

const MODE_LABELS: Record<Mode, string> = {
  edit: "Edit Selection",
  draft: "Story Creation",
  feedback: "Document Feedback",
  format: "Format Document",
  chat: "Chat",
  pipe_world_state: "Build World",
  pipe_beat_gen: "Suggest Beats",
  pipe_causality: "Connect the Story",
  pipe_plot_synth: "Write Plots",
  pipe_continuation_state: "Build Continuation State",
  pipe_continuation_beats: "Suggest Continuation Beats",
  pipe_continuation_logic: "Connect Continuation Story",
  pipe_continuation_synth: "Write Continuation Pack",
  plot_lab_chat: "Plot Lab",
  plot_lab_save_preview: "Plot Lab Save Preview",
  plot_lab_final_plot: "Plot Lab Final Plot",
};

// Strip structural tags ([H1] [P] [UL] etc.) and [CHANGE] scaffolding for
// display. Writers see just the prose — they copy anything actionable by hand.
export function stripTagsForDisplay(text: string): string {
  const changeBlocks = text.split(/\[CHANGE \d+\]/i);
  let working = text;
  if (changeBlocks.length > 1) {
    working = changeBlocks
      .slice(1)
      .map((block) => block.match(/Suggested:\s*([\s\S]*?)$/i)?.[1]?.trim() ?? "")
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
  return working
    .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")
    .split("\n")
    .map((l) => l.replace(/^\[(?:H\d|OL|UL|P|HR)\]\s*/, ""))
    .filter((l) => l.trim())
    .join("\n");
}

type CharacterDraft = {
  personality: string;
  voice: string;
  sampleDialogue: string;
  relationships: string;
};

const EMPTY_CHARACTER_DRAFT: CharacterDraft = {
  personality: "",
  voice: "",
  sampleDialogue: "",
  relationships: "",
};

const CHARACTER_QUESTIONS: {
  key: keyof CharacterDraft;
  label: string;
  question: string;
  suggestions: { title: string; answer: string }[];
}[] = [
  {
    key: "personality",
    label: "Personality",
    question: "Which performable personality traits should shape how this character behaves on the page?",
    suggestions: [
      { title: "Controlled and guarded", answer: "Controlled, guarded, hard to read, reveals only what helps them keep leverage." },
      { title: "Fast and reactive", answer: "Impulsive, defensive under pressure, pushes forward before fully thinking it through." },
    ],
  },
  {
    key: "voice",
    label: "Voice",
    question: "How should they sound in dialogue, especially when they want control or feel exposed?",
    suggestions: [
      { title: "Few words, high control", answer: "Uses few words, speaks from power, lets silence do some of the work." },
      { title: "Talks to stay ahead", answer: "Fast, verbal, performs confidence, uses jokes or sharp replies to avoid looking weak." },
    ],
  },
  {
    key: "sampleDialogue",
    label: "Dialogue mode 1",
    question: "Pick one emotional mode from the plot and capture how they speak to a main character.",
    suggestions: [
      { title: "Challenge", answer: "Challenge, to a rival: \"Choose carefully.\" / When pushed back: \"I already did.\"" },
      { title: "Vulnerability", answer: "Vulnerability, to someone close: \"I have this handled.\" / When exposed: \"Then why are your hands shaking?\"" },
    ],
  },
  {
    key: "relationships",
    label: "Dialogue mode 2",
    question: "Pick a different emotional mode and capture how they speak to another main character.",
    suggestions: [
      { title: "Flirtation", answer: "Flirtation, to a love interest: \"You always this difficult?\" / Softer: \"Good. I was hoping it was just for me.\"" },
      { title: "Fear", answer: "Fear, to someone they cannot lose: \"Do not make me say it.\" / Breaking: \"I was scared you would not come back.\"" },
    ],
  },
];


function readCharacterDraft(body: string): CharacterDraft {
  const read = (label: string) => {
    const value = body.match(new RegExp(`^\\[P\\]\\s*${label}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
    return /^\[.*\]$/.test(value) || /your answer|write two short lines/i.test(value) || /^(?:what drives them|how do they speak|for each key person|write two lines|personality q|voice q|relationship q)/i.test(value) ? "" : value;
  };
  return {
    personality: read("Personality"),
    voice: read("Voice"),
    sampleDialogue: read("Sample Dialogue"),
    relationships: read("Emotional Dialogue") || read("Relationships"),
  };
}

function isCompleteCharacterDraft(draft: CharacterDraft): boolean {
  return Object.values(draft).every((value) => value.trim().length > 0 && !/^\[.*\]$/.test(value.trim()));
}

function isSkippedCharacterBody(body: string): boolean {
  return /^\[P\]\s*(?:Profile\s+)?Status:\s*Skipped\b/im.test(body);
}

function isReadyCharacterBody(body: string): boolean {
  return isSkippedCharacterBody(body) || isCompleteCharacterDraft(readCharacterDraft(body));
}

function hideLegacyQuestionPrompts(tagged: string): string {
  return tagged
    .replace(/^\[P\]\s*Personality Q:.*?\bA:\s*(.*)$/gim, "[P] Personality: $1")
    .replace(/^\[P\]\s*Voice Q:.*?\bA:\s*(.*)$/gim, "[P] Voice: $1")
    .replace(/^\[P\]\s*Sample dialogue:(?:\s*Add 2[–-]3 short lines in their own words\.)?\s*(?:A:\s*)?(.*)$/gim, "[P] Sample Dialogue: $1")
    .replace(/^\[P\]\s*Relationship Q.*?\bA:\s*(.*)$/gim, "[P] Relationships: $1")
    .replace(/^\[P\]\s*Personality answer:\s*(.*)$/gim, "[P] Personality: $1")
    .replace(/^\[P\]\s*Voice answer:\s*(.*)$/gim, "[P] Voice: $1")
    .replace(/^\[P\]\s*Sample dialogue answer:\s*(.*)$/gim, "[P] Sample Dialogue: $1")
    .replace(/^\[P\]\s*Relationship answer:\s*(.*)$/gim, "[P] Relationships: $1")
    .replace(/^\[P\]\s*(?:Personality|Voice|Relationship) Q\b.*$/gim, "")
    .replace(/^\[P\]\s*Plot-based starting point:\s*(.*)$/gim, "[P] Story starting point: $1")
    .replace(/^\[P\]\s*(?:Personality|Voice|Sample Dialogue|Relationships):\s*(?:What drives them,.*|How do they speak,.*|Write 2[–-]3 short lines.*|For each key person,.*)\s*$/gim, "")
    .replace(/^\[P\]\s*(?:Personality|Voice|Sample Dialogue|Relationships):\s*(?:\[Your answer\]|\[Write[^\]]*\])\s*$/gim, "")
    .replace(/^\[P\]\s*(?:Personality|Voice|Sample Dialogue|Relationships):\s*$/gim, "")
    .replace(/^\[H3\]\s*.+\s*$/gim, "")
    .replace(/^\[H2\]\s*(?:Relationships|Character Name)\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n");
}

function summarizeAnswer(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  const shortened = compact.slice(0, maxLength - 3).replace(/\s+\S*$/, "").trim();
  return (shortened || compact.slice(0, maxLength - 3)) + "...";
}

function readStoryBasis(body: string): string {
  const startingPoint = body.match(/^\[P\]\s*Story starting point:\s*(.*)$/im)?.[1]?.trim();
  if (startingPoint) return startingPoint;
  const summary = body.match(/^\[P\]\s*Summary:\s*(.*)$/im)?.[1]?.trim() ?? "";
  return summary.match(/^Story:\s*(.*?)\s*\|\s*Drive:/i)?.[1]?.trim() ?? "";
}

function buildCharacterSummary(storyBasis: string, draft: CharacterDraft, sampleDialogue: string): string {
  return [
    storyBasis ? "Story: " + summarizeAnswer(storyBasis, 125) : "",
    "Drive: " + summarizeAnswer(draft.personality, 95),
    "Voice: " + summarizeAnswer(draft.voice, 95),
    "Dialogue 2: " + summarizeAnswer(draft.relationships, 95),
    "Sample: " + summarizeAnswer(sampleDialogue, 75),
  ].filter(Boolean).join(" | ");
}

function buildCharacterProfileBody(body: string, draft: CharacterDraft): string {
  const cleanAnswer = (value: string) => value.trim().replace(/\r?\n+/g, " ");
  const sampleDialogue = draft.sampleDialogue.trim().split(/\r?\n+/).map((line) => line.trim()).filter(Boolean).join(" / ");
  return [
    "[P] Summary: " + buildCharacterSummary(readStoryBasis(body), draft, sampleDialogue),
    "[P] Profile Status: Complete",
    "[P] Personality: " + cleanAnswer(draft.personality),
    "[P] Voice: " + cleanAnswer(draft.voice),
    "[P] Sample Dialogue: " + sampleDialogue,
    "[P] Emotional Dialogue: " + cleanAnswer(draft.relationships),
  ].join("\n");
}

function buildSkippedCharacterProfileBody(body: string): string {
  const storyBasis = readStoryBasis(body);
  return [
    storyBasis ? "[P] Story starting point: " + storyBasis : "",
    "[P] Profile Status: Skipped",
  ].filter(Boolean).join("\n");
}

function buildCharacterSuggestions(
  characterName: string,
  body: string,
  question: (typeof CHARACTER_QUESTIONS)[number],
  characterNames: string[] = []
): { title: string; answer: string }[] {
  const storyBasis = readStoryBasis(body);
  const draft = readCharacterDraft(body);
  const source = [characterName, storyBasis, draft.personality, draft.voice, draft.relationships].join(" ").toLowerCase();
  const currentName = characterName.toLowerCase();
  const otherNames = characterNames.filter((name) => name.toLowerCase() !== currentName);
  const primaryOther = otherNames[0] ?? "the other lead";
  const hasAny = (words: string[]) => words.some((word) => source.includes(word));
  const unique = (items: { title: string; answer: string }[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 4);
  };
  const suggestions: { title: string; answer: string }[] = [];

  if (hasAny(["mafia", "crime", "gang", "don", "boss", "cartel", "underworld", "threat", "power"])) {
    if (question.key === "personality") suggestions.push(
      { title: "Power first", answer: "Commanding, strategic, speaks from a position of power, expects others to adjust." },
      { title: "Hard to read", answer: "Mysterious, controlled, never reveals the full truth or the full threat." },
    );
    if (question.key === "voice") suggestions.push(
      { title: "Few words", answer: "Uses few words, calm threats, long pauses, and direct eye contact." },
      { title: "Indirect menace", answer: "Polite on the surface, dangerous underneath, makes others infer the consequence." },
    );
    if (question.key === "sampleDialogue") suggestions.push(
      { title: "Threat", answer: "Threat, to an underling: \"You should have come to me first.\" / To a rival: \"Now I have to decide what that means.\"" },
      { title: "Challenge", answer: "Challenge, to a challenger: \"Sit.\" / When defied: \"We are finished when I say we are finished.\"" },
    );
    if (question.key === "relationships") suggestions.push(
      { title: "Loyalty", answer: "Loyalty, to someone they protect: \"I do not ask twice because I should not have to.\" / Softer: \"Stay behind me.\"" },
      { title: "Fear", answer: "Fear, to someone who knows too much: \"Forget what you saw.\" / Honest crack: \"If they find you, I cannot save you.\"" },
    );
  }

  if (hasAny(["interview", "office", "heel", "taxi", "manhattan", "hugh", "rose", "sophie", "job"])) {
    const isHughLike = /hugh/i.test(characterName);
    if (question.key === "personality") suggestions.push(
      ...(isHughLike ? [
        { title: "Controlled authority", answer: "Composed, observant, used to being obeyed, tests confidence before trusting it." },
        { title: "Dryly amused", answer: "Sharp, restrained, quietly entertained by chaos but reluctant to show warmth." },
      ] : [
        { title: "Scrappy ambition", answer: "Ambitious, scrappy, quick to improvise, determined to look more polished than they feel." },
        { title: "Proud under pressure", answer: "Proud, defensive when judged, turns embarrassment into forward motion." },
      ]),
    );
    if (question.key === "voice") suggestions.push(
      ...(isHughLike ? [
        { title: "Measured authority", answer: "Measured, dry, economical; asks questions that feel like tests." },
        { title: "Quiet provocation", answer: "Calm on the surface, uses tiny remarks to unsettle people who overperform." },
      ] : [
        { title: "Performed confidence", answer: "Sounds polished when prepared, fast and prickly when cornered." },
        { title: "Sharp comeback", answer: "Uses quick replies, stubborn logic, and charm to recover from awkward moments." },
      ]),
    );
    if (question.key === "sampleDialogue") suggestions.push(
      ...(isHughLike ? [
        { title: "Challenge", answer: `Challenge, to ${primaryOther}: "You seem very certain for someone improvising." / When pushed: "Convince me."` },
        { title: "Amusement", answer: `Amusement, to ${primaryOther}: "That was almost graceful." / Softer: "Almost is doing a lot of work."` },
      ] : [
        { title: "Challenge", answer: `Challenge, to ${primaryOther}: "I know exactly what I am doing." / When challenged: "Then stop looking so surprised."` },
        { title: "Performance", answer: `Performance, to authority: "Of course I belong here." / To ${primaryOther}: "I just got here faster than my shoes did."` },
      ]),
    );
    if (question.key === "relationships") suggestions.push(
      ...(isHughLike ? [
        { title: "Flirtation", answer: `Flirtation, to ${primaryOther}: "You argue like this is a job requirement." / Softer: "I may be enjoying the interview."` },
        { title: "Respect", answer: `Respect, to ${primaryOther}: "You held your ground." / More honest: "That is rarer than you think."` },
      ] : [
        { title: "Flirtation", answer: `Flirtation, to ${primaryOther}: "You always this impossible?" / Softer: "Good. I was worried it was just me."` },
        { title: "Fear", answer: `Fear, to ${primaryOther}: "Please do not make this the thing that ruins me." / Recovering: "Actually, forget I said please."` },
      ]),
    );
  }

  if (hasAny(["royal", "king", "queen", "prince", "princess", "court", "palace", "heir"])) {
    if (question.key === "personality") suggestions.push(
      { title: "Public composure", answer: "Poised, duty-bound, hides private feeling behind etiquette and control." },
      { title: "Born to status", answer: "Status-aware, formal, used to being watched and rarely asks directly." },
    );
    if (question.key === "voice") suggestions.push(
      { title: "Elegant restraint", answer: "Formal, precise, restrained; insults sound like compliments until too late." },
      { title: "Commanding softness", answer: "Soft voice, clear command, never needs to raise volume to own the room." },
    );
    if (question.key === "sampleDialogue") suggestions.push(
      { title: "Duty", answer: "Duty, to family or court: \"I know what is required.\" / Privately: \"That does not mean it costs me nothing.\"" },
      { title: "Challenge", answer: "Challenge, to a rival: \"Careful. You are speaking to the crown.\" / Softer: \"Not only the crown.\"" },
    );
    if (question.key === "relationships") suggestions.push(
      { title: "Love", answer: "Love, to someone forbidden: \"Do not ask me as a prince.\" / Honest: \"Ask me as myself.\"" },
      { title: "Fear", answer: "Fear, to someone they may lose: \"If you leave now, I cannot follow.\" / Breaking: \"But I will want to.\"" },
    );
  }

  if (hasAny(["ceo", "corporate", "board", "company", "executive", "office", "merger", "investor", "startup"])) {
    if (question.key === "personality") suggestions.push(
      { title: "Boardroom control", answer: "Strategic, decisive, image-conscious, calculates before revealing emotion." },
      { title: "Pressure operator", answer: "Calm under stress, unsentimental in public, measures people by competence." },
    );
    if (question.key === "voice") suggestions.push(
      { title: "Outcome language", answer: "Precise, economical, speaks in outcomes, deadlines, risks, and decisions." },
      { title: "Polite but final", answer: "Controlled politeness, quiet authority, turns questions into decisions." },
    );
    if (question.key === "sampleDialogue") suggestions.push(
      { title: "Challenge", answer: "Challenge, to a senior rival: \"Bring me options, not anxiety.\" / When pressed: \"Then bring me numbers by noon.\"" },
      { title: "Respect", answer: "Respect, to a capable equal: \"You were right about the risk.\" / Boundary: \"Do not mistake that for hesitation.\"" },
    );
    if (question.key === "relationships") suggestions.push(
      { title: "Fear", answer: "Fear, to someone who sees the cost: \"If this fails, it is on me.\" / Softer: \"That does not mean I am not afraid.\"" },
      { title: "Love", answer: "Love, to someone private: \"I can run the company.\" / Honest: \"I do not know how to come home from it.\"" },
    );
  }

  if (hasAny(["cafe", "coffee", "barista", "bakery", "waitress", "happy", "sunny", "cheerful", "go lucky"])) {
    if (question.key === "personality") suggestions.push(
      { title: "Bright chaos", answer: "Warm, spontaneous, optimistic, finds fun in small disasters." },
      { title: "Open-hearted", answer: "Emotionally open, generous too quickly, covers fear with cheer." },
    );
    if (question.key === "voice") suggestions.push(
      { title: "Bubbly honesty", answer: "Quick, casual, warmly teasing, says true things before realizing they are true." },
      { title: "Softens tension", answer: "Uses humor, kindness, and tiny observations to make people feel safe." },
    );
    if (question.key === "sampleDialogue") suggestions.push(
      { title: "Flirtation", answer: "Flirtation, to a regular customer: \"You always order bitter coffee for someone with such dramatic eyes.\" / Softer: \"I remember how you take it.\"" },
      { title: "Comfort", answer: "Comfort, to a friend: \"Sit. I am prescribing coffee and one extremely biased pep talk.\" / Gentle: \"You do not have to be fine here.\"" },
    );
    if (question.key === "relationships") suggestions.push(
      { title: "Fear", answer: "Fear, to someone leaving: \"I am smiling because if I stop, I might beg.\" / Honest: \"Please come back.\"" },
      { title: "Love", answer: "Love, to someone close: \"I saved you the good muffin.\" / Braver: \"And maybe also my whole ridiculous heart.\"" },
    );
  }

  if (question.key === "personality") suggestions.push(
    { title: "Guarded strategist", answer: "Observant, strategic, emotionally guarded, reveals only what is useful." },
    { title: "Open-hearted impulse", answer: "Warm, impulsive, transparent, acts from feeling before strategy." },
    { title: "Status performer", answer: "Image-conscious, competitive, wants to be seen as capable and in control." },
    { title: "Soft but stubborn", answer: "Kind on the surface, stubborn underneath, bends slowly and remembers slights." },
  );
  if (question.key === "voice") suggestions.push(
    { title: "Short and controlled", answer: "Brief, controlled, low-emotion sentences; pressure makes them quieter." },
    { title: "Fast and expressive", answer: "Talks quickly, shows emotion, uses humor or deflection when uncomfortable." },
    { title: "Dry and precise", answer: "Dry wit, precise wording, rarely says more than they have to." },
    { title: "Warm and direct", answer: "Plainspoken, emotionally direct, disarming because they do not overperform." },
  );
  if (question.key === "sampleDialogue") suggestions.push(
    { title: "Challenge", answer: `Challenge, to ${primaryOther}: "Say what you came to say." / When threatened: "Careful."` },
    { title: "Deflection", answer: `Deflection, to ${primaryOther}: "That is one interpretation." / When embarrassed: "Can we pretend I did not say that?"` },
    { title: "Truth", answer: `Truth, to ${primaryOther}: "I want the truth." / When hurt: "Then stop making me guess."` },
    { title: "Old wound", answer: "Old wound, to family: \"You know enough.\" / When pushed: \"That is not the same as knowing me.\"" },
  );
  if (question.key === "relationships") suggestions.push(
    { title: "Flirtation", answer: `Flirtation, to ${primaryOther}: "You always look at people like that?" / Softer: "No, do not answer. I like guessing."` },
    { title: "Fear", answer: `Fear, to ${primaryOther}: "Do not make me say it." / Breaking: "I was scared you would not come back."` },
    { title: "Love", answer: `Love, to ${primaryOther}: "I am not good at this part." / Honest: "But I am here."` },
    { title: "Apology", answer: `Apology, to ${primaryOther}: "I was wrong." / Harder truth: "And I knew it when I did it."` },
  );

  return unique(suggestions);
}

function normalizeCharacterTab(tagged: string): string {
  let normalized = hideLegacyQuestionPrompts(tagged);
  const completed = parseCharacterProfiles(normalized)
    .filter(({ body }) => isCompleteCharacterDraft(readCharacterDraft(body)))
    .sort((left, right) => right.bodyStart - left.bodyStart);
  for (const profile of completed) {
    const body = buildCharacterProfileBody(profile.body, readCharacterDraft(profile.body));
    const prefix = normalized.slice(0, profile.bodyStart).replace(/\s+$/, "");
    const suffix = normalized.slice(profile.end).replace(/^\s+/, "");
    const replacement = prefix + "\n" + body + (suffix ? "\n" + suffix : "");
    if (normalized.slice(profile.bodyStart, profile.end).trim() !== body) normalized = replacement;
  }
  return normalized;
}

// ─── Props ───

type PipelineBranch = "monetization" | "regular";
type PlotLabSaveKind = "decision_lock" | "character_lock" | "location_lock" | "beat_shortlist" | "episode_sketch_lock" | "final_plot_commit";

const PLOT_LAB_SAVE_LABELS: Record<PlotLabSaveKind, string> = {
  decision_lock: "Plot Lab decision",
  character_lock: "Character decision",
  location_lock: "Location decision",
  beat_shortlist: "Selected beat",
  episode_sketch_lock: "Episode sketch",
  final_plot_commit: "Final plot",
};

const PLOT_LAB_DESTINATION_LABELS: Record<PlotLabSaveKind, string> = {
  decision_lock: "Plot Lab Decisions",
  character_lock: "Characters",
  location_lock: "Locations",
  beat_shortlist: "Beats",
  episode_sketch_lock: "Episode Sketches",
  final_plot_commit: "Microdrama Plots",
};

function targetTabTypeForPlotLabSave(kind: PlotLabSaveKind): string {
  if (kind === "decision_lock") return "plot_lab_decisions";
  if (kind === "character_lock") return "characters";
  if (kind === "location_lock") return "locations";
  if (kind === "beat_shortlist") return "beat_sequence";
  if (kind === "final_plot_commit") return "microdrama_plots";
  return "episode_sketches";
}

function stripAssistantTextForSave(content: string): string {
  const display = stripTagsForDisplay(content);
  const textToSave = display.match(/^Text to save:\s*(.+)$/im)?.[1]?.trim();
  if (textToSave) return textToSave;
  return display
    .replace(/^Save Preview\s*/i, "")
    .replace(/^(?:Save kind|Destination tab|Why it matters):.*$/gim, "")
    .replace(/^Text to save:\s*/gim, "")
    .trim();
}

function inferPlotLabSaveKind(content: string): PlotLabSaveKind {
  const display = stripTagsForDisplay(content);
  const destination = display.match(/^Destination tab:\s*(.+)$/im)?.[1]?.trim().toLowerCase() ?? "";
  const saveKind = display.match(/^Save kind:\s*(.+)$/im)?.[1]?.trim().toLowerCase() ?? "";
  const combined = `${destination} ${saveKind}`;
  if (combined.includes("plot lab") || combined.includes("decision ledger") || combined.includes("runway decision") || combined.includes("soul") || combined.includes("paywall") || combined.includes("core contract")) return "decision_lock";
  if (combined.includes("microdrama") || combined.includes("final plot")) return "final_plot_commit";
  if (combined.includes("episode sketch")) return "episode_sketch_lock";
  if (combined.includes("beat")) return "beat_shortlist";
  if (combined.includes("location")) return "location_lock";
  if (combined.includes("character")) return "character_lock";
  return "decision_lock";
}

function taggedParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((block) => `[P] ${block}`)
    .join("\n");
}

function buildPlotLabTaggedSave(kind: PlotLabSaveKind, text: string, episodeNumber: string): string {
  const body = taggedParagraphs(text);
  const episode = episodeNumber.trim();
  const timestamp = new Date().toISOString().slice(0, 10);
  if (kind === "episode_sketch_lock") {
    const title = episode ? `Episode ${episode} Sketch` : `Episode Sketch ${timestamp}`;
    return `[H3] ${title}\n${body}`;
  }
  if (kind === "final_plot_commit") {
    if (/^\[H3\]/m.test(text)) return text.trim();
    const title = episode ? `Episode ${episode}: Plot` : `Episode Plot ${timestamp}`;
    return `[H3] ${title}\n${body}`;
  }
  if (kind === "beat_shortlist") return `[H2] Selected Beats ${timestamp}\n${body}`;
  if (kind === "location_lock") return `[H2] Location Decisions ${timestamp}\n${body}`;
  if (kind === "decision_lock") {
    const section = inferPlotLabDecisionSection(text);
    return `[H2] ${section}\n${body}`;
  }
  return `[H2] Character Decisions ${timestamp}\n${body}`;
}

interface PlotLabChoice {
  key: string;
  label: string;
  detail: string;
  response: string;
  compact?: boolean;
}

function cleanPlotLabChoiceText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

function plotLabChoiceLineMatch(line: string): RegExpMatchArray | null {
  return line.match(/^\s*[-•]?\s*(?:\*\*)?((?:[A-D]\d*)|(?:Option\s+\d+)|(?:\d+))\)\s*(.*)$/i);
}

function latestPlotLabChoiceWindow(lines: string[]): { start: number; end: number } | null {
  const choiceIndexes = lines
    .map((line, index) => (plotLabChoiceLineMatch(line) ? index : -1))
    .filter((index) => index >= 0);
  if (choiceIndexes.length === 0) return null;

  let start = choiceIndexes[choiceIndexes.length - 1];
  const lastChoice = start;
  for (let index = choiceIndexes.length - 2; index >= 0; index -= 1) {
    const previous = choiceIndexes[index];
    const between = lines.slice(previous + 1, start).join("\n").trim();
    if (between.length > 0) break;
    start = previous;
  }
  let end = lastChoice + 1;
  while (end < lines.length && lines[end].trim().length === 0) end += 1;
  return { start, end };
}

function parsePlotLabChoices(text: string): { prompt: string; choices: PlotLabChoice[]; after: string } | null {
  const lines = text.split("\n");
  const window = latestPlotLabChoiceWindow(lines);
  if (!window) return null;

  const optionLines = lines.slice(window.start, window.end);
  const choices: PlotLabChoice[] = [];

  for (const line of optionLines) {
    const match = plotLabChoiceLineMatch(line);
    if (!match) continue;
    const key = match[1].replace(/\s+/g, " ").trim().toUpperCase();
    const rest = match[2].trim();
    const titleMatch = rest.match(/^(.*?)(?:\*\*)?\s*:\s*(.*)$/);
    const label = cleanPlotLabChoiceText(titleMatch?.[1] ?? rest);
    const detail = cleanPlotLabChoiceText(titleMatch?.[2] ?? "");
    if (!label || !detail) continue;
    const response = detail ? `I choose ${key}: ${label}. ${detail}` : `I choose ${key}: ${label}`;
    choices.push({ key, label, detail, response });
  }

  if (choices.length < 2) return null;
  return {
    prompt: lines.slice(0, window.start).join("\n").trim(),
    choices: choices.slice(-4),
    after: lines.slice(window.end).join("\n").trim(),
  };
}

function uniquePlotLabChoices(choices: PlotLabChoice[]): PlotLabChoice[] {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = choice.key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseInlinePlotLabQuickChoices(text: string): PlotLabChoice[] {
  const choices: PlotLabChoice[] = [];
  const replyMatch = text.match(/\b(?:reply|choose|pick|select)\s+(?:with\s+)?([A-D]\d?(?:\s*,\s*[A-D]\d?)*(?:\s*,?\s*or\s+[A-D]\d?)?)/i);
  if (replyMatch) {
    for (const token of replyMatch[1].match(/[A-D]\d?/gi) ?? []) {
      const key = token.toUpperCase();
      choices.push({ key, label: key, detail: "", response: `I choose ${key}.`, compact: true });
    }
  }

  if (/\byes\s*\/\s*no\b/i.test(text) || /\bconfirm\b/i.test(text)) {
    choices.push(
      { key: "yes", label: "Yes, confirm", detail: "", response: "Yes, confirm this.", compact: true },
      { key: "tweak", label: "Tweak", detail: "", response: "I want to tweak this before confirming.", compact: true },
      { key: "no", label: "No", detail: "", response: "No, this is not right.", compact: true }
    );
  }

  if (/\breroll\b|\bnew options\b|\btry again\b/i.test(text)) {
    choices.push({ key: "reroll", label: "Reroll", detail: "", response: "Reroll these options with a different angle.", compact: true });
  }

  if (choices.length === 0 && /\?$/.test(text.trim())) {
    choices.push(
      { key: "agree", label: "Looks right", detail: "", response: "This looks right. Continue.", compact: true },
      { key: "custom", label: "I will type", detail: "", response: "", compact: true }
    );
  }

  return uniquePlotLabChoices(choices).filter((choice) => choice.response || choice.key === "custom");
}

function normalizeAssistantDisplayContent(content: string): string {
  if (content.startsWith("[CLARIFY]")) {
    return content.replace(/^\[CLARIFY\]\s*/, "");
  }
  if (/^\[(?:H\d|OL|UL|P)]/m.test(content) || content.includes("[CHANGE")) {
    return stripTagsForDisplay(content);
  }
  return content;
}

function hasPlotLabActions(content: string): boolean {
  const displayContent = normalizeAssistantDisplayContent(content);
  return Boolean(parsePlotLabChoices(displayContent)) || parseInlinePlotLabQuickChoices(displayContent).length > 0;
}

function isPlotLabMode(mode: Mode): boolean {
  return mode === "plot_lab_chat" || mode === "plot_lab_save_preview" || mode === "plot_lab_final_plot";
}

function isPlotLabStageSummary(content: string): boolean {
  const displayContent = normalizeAssistantDisplayContent(content);
  return /stage summary/i.test(displayContent)
    && /what was decided/i.test(displayContent)
    && /what this unlocks/i.test(displayContent)
    && /destination tab/i.test(displayContent)
    && /-\s*A\)\s*Confirm/i.test(displayContent);
}

function isPlotLabConfirmDecision(decisionText: string): boolean {
  return /\b(?:yes,\s*)?confirm\b|\blooks right\b|\bthis looks right\b|\bsave this\b/i.test(decisionText);
}

interface AIChatSidebarProps {
  documentId: string;
  tabs: TabRow[];
  activeTab: TabRow;
  editorRef: RefObject<EditorHandle | null>;
  editorIsEmpty: boolean;
  modelId: string;
  thinking: boolean;
  isAdmin: boolean;
  pipelineBranch: PipelineBranch;
  plotLabActive: boolean;
  canUsePlotLab: boolean;
  aiJob: AIJobController;
  onFlushPendingSave: () => Promise<void>;
  onAIJobApplied: (landedTabId: string) => Promise<void>;
  onSetModel: (modelId: string) => void;
  onSetThinking: (enabled: boolean) => void;
  onSetTitle: (title: string) => void;
  onPlotLabActiveChange: (active: boolean) => void;
  onClose: () => void;
}

export default function AIChatSidebar({
  documentId,
  tabs,
  activeTab,
  editorRef,
  modelId,
  thinking,
  isAdmin,
  pipelineBranch,
  plotLabActive,
  canUsePlotLab,
  aiJob,
  onFlushPendingSave,
  onAIJobApplied,
  onSetModel,
  onSetThinking,
  onPlotLabActiveChange,
  onClose,
}: AIChatSidebarProps) {
  type PipelineStepId =
    | "pipe_world_state"
    | "pipe_beat_gen"
    | "pipe_causality"
    | "pipe_plot_synth"
    | "pipe_continuation_state"
    | "pipe_continuation_beats"
    | "pipe_continuation_logic"
    | "pipe_continuation_synth";

  type PipelineGroup = "Monetization Runway" | "Beyond Monetization";

  const PIPELINE_STEPS = useMemo<{
    id: PipelineStepId;
    label: string;
    group: PipelineGroup;
    enabledWhenTabType: string;
    requiredTabLabel: string;
  }[]>(() => [
    { id: "pipe_world_state", label: "Build World", group: "Monetization Runway", enabledWhenTabType: "series_overview", requiredTabLabel: "Series Overview" },
    { id: "pipe_beat_gen", label: "Suggest Beats", group: "Monetization Runway", enabledWhenTabType: "world_state", requiredTabLabel: "World State" },
    { id: "pipe_causality", label: "Connect the Story", group: "Monetization Runway", enabledWhenTabType: "beat_sequence", requiredTabLabel: "Beats" },
    { id: "pipe_plot_synth", label: "Write Plots", group: "Monetization Runway", enabledWhenTabType: "story_logic", requiredTabLabel: "Story Logic" },
    { id: "pipe_continuation_state", label: "Build Continuation State", group: "Beyond Monetization", enabledWhenTabType: "microdrama_plots", requiredTabLabel: "Microdrama Plots" },
    { id: "pipe_continuation_beats", label: "Suggest Continuation Beats", group: "Beyond Monetization", enabledWhenTabType: "world_state", requiredTabLabel: "World State" },
    { id: "pipe_continuation_logic", label: "Connect Continuation Story", group: "Beyond Monetization", enabledWhenTabType: "beat_sequence", requiredTabLabel: "Beats" },
    { id: "pipe_continuation_synth", label: "Write Continuation Pack", group: "Beyond Monetization", enabledWhenTabType: "story_logic", requiredTabLabel: "Story Logic" },
  ], []);
  const [activeStep, setActiveStep] = useState<PipelineStepId | null>(null);
  const selectedPipelineGroup: PipelineGroup = isAdmin && pipelineBranch === "regular" ? "Beyond Monetization" : "Monetization Runway";
  const mode: Mode = plotLabActive ? "plot_lab_chat" : activeStep ?? "chat";
  const getStepLabel = useCallback((step: { id: PipelineStepId; label: string }) => {
    if (isAdmin && step.id === "pipe_plot_synth") return "Write Monetization Plot";
    return step.label;
  }, [isAdmin]);
  const getModeLabel = useCallback((entryMode: Mode) => {
    if (isAdmin && entryMode === "pipe_plot_synth") return "Write Monetization Plot";
    return MODE_LABELS[entryMode];
  }, [isAdmin]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  const [questionnaireCharacter, setQuestionnaireCharacter] = useState("");
  const [questionnaireStep, setQuestionnaireStep] = useState(0);
  const [characterDrafts, setCharacterDrafts] = useState<Record<string, CharacterDraft>>({});
  const [answerSelections, setAnswerSelections] = useState<Record<string, string>>({});
  const [isApplyingJob, setIsApplyingJob] = useState(false);
  const [plotLabSaveOpen, setPlotLabSaveOpen] = useState(false);
  const [plotLabSaveText, setPlotLabSaveText] = useState("");
  const [plotLabSaveKind, setPlotLabSaveKind] = useState<PlotLabSaveKind>("episode_sketch_lock");
  const [plotLabEpisodeNumber, setPlotLabEpisodeNumber] = useState("");
  const [isPlotLabSaving, setIsPlotLabSaving] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    try { return localStorage.getItem("ai-send-on-enter") === "true"; } catch { return false; }
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputPanelHeightRef = useRef(160);
  const [inputPanelHeight, setInputPanelHeight] = useState(160);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = inputPanelHeightRef.current;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const containerH = containerRef.current?.getBoundingClientRect().height ?? 600;
      const next = Math.min(containerH * 0.5, Math.max(120, startH + delta));
      inputPanelHeightRef.current = next;
      setInputPanelHeight(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const isAIBusy = aiJob.state.status === "starting" || aiJob.state.status === "running";
  const latestActionableHistoryIndex = useMemo(() => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const entry = history[index];
      if (entry.type === "mode-change") continue;
      if (entry.role === "user") return -1;
      if (entry.mode === "plot_lab_chat" && hasPlotLabActions(entry.content)) return index;
      if (entry.mode === "plot_lab_save_preview") return index;
      return -1;
    }
    return -1;
  }, [history]);

  const characterTab = tabs.find((tab) => tab.type === "characters");
  const characterTagged = tiptapJsonToTagged(
    activeTab.type === "characters"
      ? editorRef.current?.getContentJSON() ?? characterTab?.content ?? null
      : characterTab?.content ?? null
  );
  const characterProfiles = useMemo(() => parseCharacterProfiles(characterTagged), [characterTagged]);
  const pendingCharacterProfiles = characterProfiles.filter(({ body }) => !isReadyCharacterBody(body));
  const readyCharacterCount = characterProfiles.length - pendingCharacterProfiles.length;
  const skippedCharacterCount = characterProfiles.filter(({ body }) => isSkippedCharacterBody(body)).length;
  const characterProfilesComplete = characterProfiles.length > 0 && pendingCharacterProfiles.length === 0;

  const persistedJobIdRef = useRef<string | null>(null);
  const lastJobEntryIdsRef = useRef<{ jobId: string; userId: string | null; assistantId: string | null } | null>(null);
  const clientApplyIdRef = useRef<string | null>(null);
  const autoAppliedCastJobRef = useRef<string | null>(null);
  const autoPreparedTabRef = useRef<string | null>(null);
  const lastAssistantTabTypeRef = useRef<string | null>(null);
  const suppressAssistantHistoryRef = useRef(false);

  const handleAddCharacterHeading = useCallback(async () => {
    if (activeTab.type !== "characters") {
      setError("Open the Characters tab before adding a character.");
      return;
    }
    const rawName = window.prompt("Character name");
    const name = rawName?.replace(/\s+/g, " ").trim();
    if (!name) return;

    const liveTagged = normalizeCharacterTab(
      tiptapJsonToTagged(editorRef.current?.getContentJSON() ?? null)
    );
    const existing = parseCharacterProfiles(liveTagged);
    const key = normalizeCharacterName(name);
    const existingProfile = existing.find((profile) => profile.key === key);
    if (existingProfile) {
      setQuestionnaireCharacter(existingProfile.name);
      setQuestionnaireStep(0);
      setQuestionnaireOpen(true);
      setNotice(`${name} is already in Characters.`);
      setError(null);
      return;
    }

    const base = liveTagged.trim() || "[H1] Characters";
    const updated = `${base}\n\n[H2] ${name}`;
    editorRef.current?.setFullContent(updated);
    setQuestionnaireCharacter(name);
    setQuestionnaireStep(0);
    setQuestionnaireOpen(true);
    setNotice(`${name} added. Complete or skip the profile before using persona-dependent agents.`);
    setError(null);
    await onFlushPendingSave();
  }, [activeTab.type, editorRef, onFlushPendingSave]);

  const handleOpenQuestionnaire = useCallback(async () => {
    if (activeTab.type !== "characters") {
      setError("Open the Characters tab to interview the cast.");
      return;
    }
    const liveTagged = tiptapJsonToTagged(editorRef.current?.getContentJSON() ?? null);
    const cleaned = normalizeCharacterTab(liveTagged);
    if (cleaned !== liveTagged) editorRef.current?.setFullContent(cleaned);
    const profiles = parseCharacterProfiles(cleaned);
    if (!profiles.length) {
      setError("Add character names to the Characters tab before starting the questionnaire.");
      return;
    }
    const drafts = Object.fromEntries(profiles.map(({ name, body }) => [name, readCharacterDraft(body)]));
    setCharacterDrafts((current) => ({ ...drafts, ...current }));
    const next = profiles.find(({ body }) => !isReadyCharacterBody(body)) ?? profiles[0];
    setQuestionnaireCharacter(next.name);
    setQuestionnaireStep(0);
    setQuestionnaireOpen(true);
    setError(null);
    setNotice(null);
    if (cleaned !== liveTagged) await onFlushPendingSave();
  }, [activeTab.type, editorRef, onFlushPendingSave]);

  const handleSaveCharacterProfile = useCallback(async () => {
    const draft = characterDrafts[questionnaireCharacter];
    if (!draft || !isCompleteCharacterDraft(draft)) {
      setError("Answer all four questions before saving this character profile.");
      return;
    }
    const liveTagged = normalizeCharacterTab(
      tiptapJsonToTagged(editorRef.current?.getContentJSON() ?? null)
    );
    const targetKey = normalizeCharacterName(questionnaireCharacter);
    const profile = parseCharacterProfiles(liveTagged).find(({ key }) => key === targetKey);
    if (!profile) {
      setError(`Could not find ${questionnaireCharacter} in the Characters tab.`);
      return;
    }
    const body = buildCharacterProfileBody(profile.body, draft);
    const updated = `${liveTagged.slice(0, profile.bodyStart)}\n${body}\n${liveTagged.slice(profile.end)}`;
    editorRef.current?.setFullContent(updated);
    try {
      await onFlushPendingSave();
      const updatedProfiles = parseCharacterProfiles(updated);
      const readyCount = updatedProfiles.filter(({ body: profileBody }) => isReadyCharacterBody(profileBody)).length;
      setNotice(`${questionnaireCharacter} profile saved. ${readyCount} of ${updatedProfiles.length} major characters ready.`);
      const next = updatedProfiles.find(({ body: profileBody }) => !isReadyCharacterBody(profileBody));
      if (next) {
        setQuestionnaireCharacter(next.name);
        setQuestionnaireStep(0);
      } else {
        setQuestionnaireOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the character profile.");
    }
  }, [characterDrafts, editorRef, onFlushPendingSave, questionnaireCharacter]);

  const handleSkipCharacterProfile = useCallback(async () => {
    const liveTagged = normalizeCharacterTab(
      tiptapJsonToTagged(editorRef.current?.getContentJSON() ?? null)
    );
    const targetKey = normalizeCharacterName(questionnaireCharacter);
    const profile = parseCharacterProfiles(liveTagged).find(({ key }) => key === targetKey);
    if (!profile) {
      setError(`Could not find ${questionnaireCharacter} in the Characters tab.`);
      return;
    }
    const body = buildSkippedCharacterProfileBody(profile.body);
    const updated = `${liveTagged.slice(0, profile.bodyStart)}\n${body}\n${liveTagged.slice(profile.end)}`;
    editorRef.current?.setFullContent(updated);
    try {
      await onFlushPendingSave();
      const updatedProfiles = parseCharacterProfiles(updated);
      const next = updatedProfiles.find(({ body: profileBody }) => !isReadyCharacterBody(profileBody));
      const readyCount = updatedProfiles.filter(({ body: profileBody }) => isReadyCharacterBody(profileBody)).length;
      setNotice(`${questionnaireCharacter} skipped. ${readyCount} of ${updatedProfiles.length} major characters ready.`);
      if (next) {
        setQuestionnaireCharacter(next.name);
        setQuestionnaireStep(0);
      } else {
        setQuestionnaireOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not skip this character.");
    }
  }, [editorRef, onFlushPendingSave, questionnaireCharacter]);

  const handleStartJob = useCallback(async (kind: JobKind = "next_reference_episode") => {
    if (kind === "next_reference_episode" && !characterProfilesComplete) {
      setError("Complete the Character Questionnaire for every major character first.");
      return;
    }
    if (isAIBusy || isStreaming) return;
    setError(null);
    setNotice(null);
    try {
      await onFlushPendingSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed before AI start.");
      return;
    }
    const r = await aiJob.start(kind);
    if (!r.ok) setError(r.error ?? "Could not start AI job.");
  }, [aiJob, characterProfilesComplete, isAIBusy, isStreaming, onFlushPendingSave]);

  const handleApplyJob = useCallback(async () => {
    if (aiJob.state.status !== "completed" || !aiJob.state.output) return;
    if (!aiJob.state.kind || !aiJob.state.originTabId) return;
    if (!aiJob.state.jobId || isApplyingJob) return;

    setIsApplyingJob(true);
    setError(null);
    try {
      await onFlushPendingSave();
      const clientApplyId =
        clientApplyIdRef.current ??
        (clientApplyIdRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      const res = await fetch(`/api/ai/jobs/${aiJob.state.jobId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientApplyId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        reason?: string;
        landedTabId?: string;
        fellBack?: boolean;
      };
      if (!res.ok || !data.ok || !data.landedTabId) {
        setError(data.error ?? `Apply failed (${data.reason ?? res.status}).`);
        return;
      }
      await onAIJobApplied(data.landedTabId);
      if (data.fellBack) setError("Original tab missing; output landed in Workbook instead.");
      clientApplyIdRef.current = null;
      aiJob.reset();
      if (aiJob.state.kind === "prepare_character_questionnaire") {
        setNotice("Major characters were identified from the story. Complete their profiles in the Character Questionnaire.");
        setQuestionnaireOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setIsApplyingJob(false);
    }
  }, [aiJob, isApplyingJob, onAIJobApplied, onFlushPendingSave]);

  useEffect(() => {
    if (activeTab.type !== "characters") {
      autoPreparedTabRef.current = null;
      return;
    }
    if (characterProfiles.length > 0 || isAIBusy || aiJob.state.status === "completed") return;
    const key = `${documentId}:${activeTab.id}`;
    if (autoPreparedTabRef.current === key) return;
    autoPreparedTabRef.current = key;
    void onFlushPendingSave()
      .then(() => aiJob.start("prepare_character_questionnaire"))
      .then((result) => {
        if (!result.ok) setError(result.error ?? "Could not identify the major cast from the story.");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not prepare character profiles."));
  }, [activeTab.id, activeTab.type, aiJob, characterProfiles.length, documentId, isAIBusy, onFlushPendingSave]);

  useEffect(() => {
    const { jobId, kind, status } = aiJob.state;
    if (kind !== "prepare_character_questionnaire" || status !== "completed" || !jobId) return;
    if (autoAppliedCastJobRef.current === jobId) return;
    autoAppliedCastJobRef.current = jobId;
    void handleApplyJob();
  }, [aiJob, handleApplyJob]);

  useEffect(() => {
    if (activeTab.type !== "characters") return;
    const normalized = normalizeCharacterTab(characterTagged);
    if (normalized === characterTagged) return;
    editorRef.current?.setFullContent(normalized);
    void onFlushPendingSave();
  }, [activeTab.type, characterTagged, editorRef, onFlushPendingSave]);

  useEffect(() => {
    if (activeTab.type !== "characters") return;
    const profiles = parseCharacterProfiles(characterTagged);
    if (!profiles.length) return;
    const pending = profiles.filter(({ body }) => !isReadyCharacterBody(body));
    if (!pending.length) return;
    setQuestionnaireCharacter((current) =>
      pending.some(({ name }) => name === current) ? current : pending[0]?.name || profiles[0].name
    );
    setQuestionnaireOpen(true);
  }, [activeTab.type, characterTagged]);

  const handleDiscardJob = useCallback(() => {
    clientApplyIdRef.current = null;
    const tracked = lastJobEntryIdsRef.current;
    if (tracked && tracked.jobId === aiJob.state.jobId) {
      const { userId, assistantId } = tracked;
      setHistory((prev) => prev.filter((e) => {
        if (e.type !== "message" || !e.id) return true;
        return e.id !== userId && e.id !== assistantId;
      }));
      if (userId) fetch(`/api/ai/chat-history?id=${userId}`, { method: "DELETE" }).catch(() => {});
      if (assistantId) fetch(`/api/ai/chat-history?id=${assistantId}`, { method: "DELETE" }).catch(() => {});
      lastJobEntryIdsRef.current = null;
    }
    aiJob.reset();
  }, [aiJob]);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setMessages([]);
    setStreamingText("");
    setError(null);
    setInput("");
    setNotice(null);
    setActiveStep(null);
    fetch(`/api/ai/chat-history?documentId=${documentId}`, { method: "DELETE" }).catch(() => {});
  }, [documentId]);

  useEffect(() => {
    if (!historyLoaded) return;
    const enteringCharacters = activeTab.type === "characters" && lastAssistantTabTypeRef.current !== "characters";
    lastAssistantTabTypeRef.current = activeTab.type;
    suppressAssistantHistoryRef.current = activeTab.type === "characters";
    if (enteringCharacters) handleClearHistory();
  }, [activeTab.type, handleClearHistory, historyLoaded]);

  const persistEntry = useCallback(
    async (entry: HistoryEntry): Promise<string | null> => {
      if (suppressAssistantHistoryRef.current) return null;
      try {
        const res = await fetch("/api/ai/chat-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId,
            entryType: entry.type === "mode-change" ? "mode-change" : "message",
            role: entry.type === "message" ? entry.role : null,
            content: entry.type === "message" ? entry.content : null,
            mode: entry.mode,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { id?: string };
        return data.id ?? null;
      } catch {
        return null;
      }
    },
    [documentId]
  );

  // Persist completed job output to chat history once per jobId
  useEffect(() => {
    if (aiJob.state.status !== "completed") return;
    if (!aiJob.state.jobId || !aiJob.state.kind || !aiJob.state.output) return;
    if (persistedJobIdRef.current === aiJob.state.jobId) return;
    persistedJobIdRef.current = aiJob.state.jobId;
    if (activeTab.type === "characters") return;
    if (aiJob.state.kind === "prepare_character_questionnaire") return;
    const jobId = aiJob.state.jobId;
    const label = JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind;
    const userEntry: HistoryEntry = { type: "message", role: "user", content: label, mode: "chat" };
    const assistantEntry: HistoryEntry = { type: "message", role: "assistant", content: aiJob.state.output, mode: "chat" };
    (async () => {
      const userId = await persistEntry(userEntry);
      const assistantId = await persistEntry(assistantEntry);
      lastJobEntryIdsRef.current = { jobId, userId, assistantId };
      setHistory((prev) => [
        ...prev,
        { ...userEntry, id: userId ?? undefined },
        { ...assistantEntry, id: assistantId ?? undefined },
      ]);
    })();
  }, [activeTab.type, aiJob.state.status, aiJob.state.jobId, aiJob.state.kind, aiJob.state.output, persistEntry]);

  // Load history on mount
  useEffect(() => {
    fetch(`/api/ai/chat-history?documentId=${documentId}`)
      .then((r) => r.json())
      .then((entries: { id: string; entryType: string; role: string | null; content: string | null; mode: string; createdAt: string }[]) => {
        if (!Array.isArray(entries)) return;
        const loaded: HistoryEntry[] = entries.map((e) =>
          e.entryType === "mode-change"
            ? { type: "mode-change" as const, id: e.id, mode: e.mode as Mode, timestamp: new Date(e.createdAt).getTime() }
            : { type: "message" as const, id: e.id, role: e.role as "user" | "assistant", content: e.content || "", mode: e.mode as Mode }
        );
        setHistory(loaded);
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [documentId]);

  useEffect(() => {
    if (historyLoaded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [historyLoaded]);

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming, streamingText]);

  const sendMessages = useCallback(
    async (
      msgs: ChatMessage[],
      opts: { selectionAtSubmit: boolean; originTabId: string; modeOverride?: Mode }
    ) => {
      const { modeOverride } = opts;
      const effectiveMode: Mode = modeOverride ?? mode;

      console.debug("[pipeline:send]", { effectiveMode, override: modeOverride ?? null });

      setIsStreaming(true);
      setStreamingText("");
      setError(null);

      try {
        const res = await fetch("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: msgs, mode: effectiveMode, modelId, thinking, documentId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "AI request failed");
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            accumulated += chunk;
            setStreamingText(accumulated.replace(/^[012]\n/, ""));
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                updated[lastIdx] = { role: "assistant", content: accumulated };
              }
              return updated;
            });
          }
        }

        const cleanAccumulated = accumulated.replace(/^[012]\n/, "");
        if (cleanAccumulated) {
          if (suppressAssistantHistoryRef.current) {
            setMessages([]);
            return;
          }
          const assistantEntry: HistoryEntry = {
            type: "message",
            role: "assistant",
            content: cleanAccumulated,
            mode: effectiveMode,
          };
          setHistory((prev) => [...prev, assistantEntry]);
          persistEntry(assistantEntry);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [documentId, mode, modelId, thinking, persistEntry]
  );

  const buildUserMessage = useCallback((userInput: string): string => {
    const liveContent = editorRef.current?.getContentJSON() ?? null;
    if (plotLabActive) {
      const contextBlock = buildPlotLabContext({
        tabs,
        activeTab,
        activeTabLiveContent: liveContent,
        userMessage: userInput,
      });
      return `${contextBlock}\n\n## Message\n${userInput}`;
    }
    const contextBlock = buildAIContext({
      tabs,
      activeTab,
      activeTabLiveContent: liveContent,
      mode: "chat",
      selection: null,
      userMessage: userInput,
    });
    return `${contextBlock}\n\n## Message\n${userInput}`;
  }, [activeTab, editorRef, plotLabActive, tabs]);

  const handleSubmit = useCallback(() => {
    if (!plotLabActive && !characterProfilesComplete) {
      setError("Complete the Character Questionnaire for every major character before using other agents.");
      return;
    }
    if (!input.trim() || isStreaming) return;

    const originTabId = activeTab.id;
    const userContent = buildUserMessage(input);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const newMessages = [...messages, userMsg, assistantMsg];

    setMessages(newMessages);
    setInput("");

    const userEntry: HistoryEntry = { type: "message", role: "user", content: input, mode };
    setHistory((prev) => [...prev, userEntry]);
    persistEntry(userEntry);

    sendMessages(newMessages.filter((m) => m.content), {
      selectionAtSubmit: false,
      originTabId,
    });
  }, [characterProfilesComplete, plotLabActive, input, isStreaming, messages, sendMessages, mode, activeTab, persistEntry, buildUserMessage]);

  const handlePlotLabDecision = useCallback((decisionText: string, sourceAssistantText?: string) => {
    if (!plotLabActive || !decisionText.trim() || isStreaming) return;

    const originTabId = activeTab.id;
    const shouldPrepareSave =
      sourceAssistantText &&
      isPlotLabConfirmDecision(decisionText) &&
      isPlotLabStageSummary(sourceAssistantText);
    const nextMode: Mode = shouldPrepareSave ? "plot_lab_save_preview" : mode;
    const nextInput = shouldPrepareSave
      ? [
          "Prepare this confirmed Plot Lab stage summary for the system-of-record save preview.",
          "",
          "## Confirmed writer choice",
          decisionText,
          "",
          "## Levi stage summary",
          normalizeAssistantDisplayContent(sourceAssistantText),
        ].join("\n")
      : decisionText;
    const userContent = buildUserMessage(nextInput);
    const userMsg: ChatMessage = { role: "user", content: userContent };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const newMessages = [...messages, userMsg, assistantMsg];

    setMessages(newMessages);
    setInput("");

    const userEntry: HistoryEntry = { type: "message", role: "user", content: decisionText, mode: nextMode };
    setHistory((prev) => [...prev, userEntry]);
    persistEntry(userEntry);

    sendMessages(newMessages.filter((m) => m.content), {
      selectionAtSubmit: false,
      originTabId,
      modeOverride: nextMode,
    });
  }, [activeTab.id, buildUserMessage, isStreaming, messages, mode, persistEntry, plotLabActive, sendMessages]);

  const openPlotLabSave = useCallback((content: string) => {
    setPlotLabSaveText(stripAssistantTextForSave(content));
    setPlotLabSaveKind(inferPlotLabSaveKind(content));
    const episodeMatch = content.match(/episode\s+(\d+)/i);
    setPlotLabEpisodeNumber(episodeMatch?.[1] ?? "");
    setPlotLabSaveOpen(true);
    setError(null);
  }, []);

  const confirmPlotLabSave = useCallback(async () => {
    const text = plotLabSaveText.trim();
    if (!text || isPlotLabSaving) return;
    const targetType = targetTabTypeForPlotLabSave(plotLabSaveKind);
    const target = tabs.find((tab) => tab.type === targetType);
    if (!target) {
      setError(`Could not find the ${PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]} tab.`);
      return;
    }

    setIsPlotLabSaving(true);
    setError(null);
    try {
      await onFlushPendingSave();
      const targetLiveContent =
        target.id === activeTab.id
          ? editorRef.current?.getContentJSON?.() ?? target.content ?? null
          : target.content ?? null;
      const existingTagged = tiptapJsonToTagged(targetLiveContent).trim();
      const taggedSave = buildPlotLabTaggedSave(plotLabSaveKind, text, plotLabEpisodeNumber);
      const nextTagged = existingTagged ? `${existingTagged}\n\n${taggedSave}` : taggedSave;

      if (target.id === activeTab.id) {
        editorRef.current?.setFullContent(nextTagged);
        await onFlushPendingSave();
      } else {
        const res = await fetch(`/api/documents/${documentId}/tabs/${target.id}/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: JSON.stringify(taggedTextToTiptapDoc(nextTagged)),
            forceVersion: true,
            versionReason: "plot_lab_confirm",
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not save Plot Lab decision.");
        }
      }

      await onAIJobApplied(target.id);
      setPlotLabSaveOpen(false);
      setNotice(`Saved to ${PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Plot Lab decision.");
    } finally {
      setIsPlotLabSaving(false);
    }
  }, [
    activeTab.id,
    documentId,
    editorRef,
    isPlotLabSaving,
    onAIJobApplied,
    onFlushPendingSave,
    plotLabEpisodeNumber,
    plotLabSaveKind,
    plotLabSaveText,
    tabs,
  ]);

  // ─── Pipeline step helpers ───

  useEffect(() => {
    if (plotLabActive && activeStep) setActiveStep(null);
  }, [activeStep, plotLabActive]);

  useEffect(() => {
    if (!activeStep) return;
    const activeGroup = PIPELINE_STEPS.find((step) => step.id === activeStep)?.group;
    if (activeGroup && activeGroup !== selectedPipelineGroup) setActiveStep(null);
  }, [activeStep, selectedPipelineGroup, PIPELINE_STEPS]);
  const isTabNonEmpty = useCallback((tabType: string): boolean => {
    const t = tabs.find((tab) => tab.type === tabType);
    if (!t?.content) return false;
    const tagged = tiptapJsonToTagged(t.content);
    // Strip H1 stubs so an empty new tab (only "[H1] World State") reads as empty
    const withoutH1 = tagged
      .split("\n")
      .filter((line) => !line.trim().startsWith("[H1]"))
      .join("\n");
    return withoutH1.trim().length > 30;
  }, [tabs]);

  const handleStepClick = useCallback(
    async (stepId: PipelineStepId) => {
      if (isStreaming) return;

      // Always confirm before running a pipeline step — it clears chat history
      // so the agent starts fresh with the right context.
      const step = PIPELINE_STEPS.find((s) => s.id === stepId);
      const stepLabel = step ? getStepLabel(step) : stepId;
      if (history.length > 0 || messages.length > 0) {
        const confirmed = window.confirm(
          `Run "${stepLabel}"?\n\nThis will clear the current chat history and start fresh. Confirm the relevant tabs are updated before continuing.`
        );
        if (!confirmed) return;
      }

      // Clear history (local state + server)
      setHistory([]);
      setMessages([]);
      setStreamingText("");
      setError(null);
      fetch(`/api/ai/chat-history?documentId=${documentId}`, { method: "DELETE" }).catch(() => {});

      setActiveStep(stepId);

      const liveWorkbookContent =
        activeTab.type === "workbook"
          ? (editorRef.current?.getContentJSON?.() ?? null)
          : null;

      const context = buildPipelineStepContext(stepId, tabs, liveWorkbookContent);

      console.debug("[pipeline:step]", {
        stepId,
        activeTabType: activeTab.type,
        usedLiveWorkbook: liveWorkbookContent !== null,
        contextChars: context.length,
      });

      const initialMessage: ChatMessage = {
        role: "user",
        content: context || "(no context available for this step yet)",
      };
      setMessages([initialMessage, { role: "assistant", content: "" }]);

      await sendMessages([initialMessage], {
        selectionAtSubmit: false,
        originTabId: activeTab.id,
        modeOverride: stepId,
      });
    },
    [isStreaming, history, messages, documentId, activeTab, editorRef, tabs, sendMessages, getStepLabel, PIPELINE_STEPS]
  );

  const handleExitStep = useCallback(() => {
    setActiveStep(null);
    setMessages([]);
  }, []);

  // ─── Render ───

  return (
    <div ref={containerRef} className="flex h-full flex-col">

      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h3 className="font-semibold text-indigo-700 leading-tight">{plotLabActive ? "Plot Lab" : "AI Assistant"}</h3>
          {plotLabActive ? (
            <p className="text-[10px] text-indigo-500 leading-tight">Levi workspace agent</p>
          ) : activeStep && (
            <p className="text-[10px] text-indigo-500 leading-tight">
              {getModeLabel(activeStep)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canUsePlotLab ? (
            <button
              type="button"
              onClick={() => onPlotLabActiveChange(!plotLabActive)}
              disabled={isStreaming}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                plotLabActive
                  ? "bg-indigo-600 text-white"
                  : "border border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              Plot Lab
            </button>
          ) : null}
          {activeTab.type !== "characters" && (
            <button
              onClick={() => {
                if (history.length === 0) return;
                if (window.confirm("Clear all chat history for this document? This cannot be undone.")) {
                  handleClearHistory();
                }
              }}
              disabled={history.length === 0 || isStreaming}
              title="Clear chat history"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">
            &times;
          </button>
        </div>
      </div>

      {/* ─── Actions (pipeline steps) ─── */}
      {!plotLabActive && (
      <div className="flex-shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Actions</span>
          {activeStep && (
            <button
              type="button"
              onClick={handleExitStep}
              className="text-[10px] text-indigo-500 hover:text-indigo-700"
            >
              Exit
            </button>
          )}
        </div>
        {activeTab.type !== "characters" && (
          <div className="space-y-2">

            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {selectedPipelineGroup === "Monetization Runway"
                  ? "EP1 to monetization"
                  : "Post-monetization continuation"}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {PIPELINE_STEPS.filter((step) => step.group === selectedPipelineGroup).map((step) => {
                  const tabFilled = isTabNonEmpty(step.enabledWhenTabType);
                  const enabled = tabFilled && !isStreaming && !isAIBusy;
                  const isActive = activeStep === step.id;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => handleStepClick(step.id)}
                      disabled={!enabled}
                      title={!tabFilled ? "Fill " + step.requiredTabLabel + " tab first" : undefined}
                      className={`rounded px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors
                        ${isActive
                          ? "bg-indigo-600 text-white"
                          : enabled
                          ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                          : "bg-muted text-muted-foreground cursor-not-allowed"
                        }`}
                    >
                      <span className="block">{getStepLabel(step)}</span>
                      {!tabFilled && (
                        <span className="block text-[9px] font-normal text-muted-foreground leading-tight mt-0.5">
                          Fill {step.requiredTabLabel}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {activeTab.type === "characters" && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void handleAddCharacterHeading()}
              disabled={isStreaming || isAIBusy}
              className="rounded px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors bg-card border border-border text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              Add Character
            </button>
            <button
              type="button"
              onClick={() => void handleOpenQuestionnaire()}
              disabled={isStreaming || isAIBusy}
              className="rounded px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              {characterProfilesComplete ? "Review Profiles" : "Build Profiles"}
              {characterProfiles.length > 0 && (
                <span className="ml-2 font-normal">
                  {readyCharacterCount}/{characterProfiles.length} ready{skippedCharacterCount > 0 ? `, ${skippedCharacterCount} skipped` : ""}
                </span>
              )}
            </button>
          </div>
        )}
        {(activeTab.type !== "characters" || characterProfilesComplete) && (
          <div className="mt-1.5 border-t border-border pt-1.5">
            <button
              type="button"
              onClick={() => handleStartJob("next_reference_episode")}
              disabled={isStreaming || isAIBusy || !characterProfilesComplete}
              title={!characterProfilesComplete ? "Complete the major character profiles first" : undefined}
              className="w-full rounded px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition-colors bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              {isAIBusy ? "Generating…" : characterProfilesComplete ? "Create Pre-defined Episode" : `Complete character profiles (${readyCharacterCount}/${characterProfiles.length})`}
            </button>
          </div>
        )}
      </div>
      )}
      {/* ─── Messages / Streaming — takes all remaining space ─── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">

        {questionnaireOpen && activeTab.type === "characters" && (() => {
          const questionnaireChoices = pendingCharacterProfiles.length > 0 ? pendingCharacterProfiles : characterProfiles;
          const selectedProfile =
            questionnaireChoices.find(({ name }) => name === questionnaireCharacter) ??
            questionnaireChoices[0] ??
            characterProfiles[0];
          const activeQuestionnaireCharacter = selectedProfile?.name ?? questionnaireCharacter;
          const draft = characterDrafts[activeQuestionnaireCharacter] ?? (selectedProfile ? readCharacterDraft(selectedProfile.body) : EMPTY_CHARACTER_DRAFT);
          const question = CHARACTER_QUESTIONS[questionnaireStep];
          const suggestions = selectedProfile
            ? buildCharacterSuggestions(selectedProfile.name, selectedProfile.body, question, characterProfiles.map(({ name }) => name))
            : question.suggestions;
          const answerSelectionKey = activeQuestionnaireCharacter + ":" + question.key;
          const selectedAnswer = answerSelections[answerSelectionKey] ?? (draft[question.key].trim() ? "manual" : "");
          return (
            <section className="rounded border border-indigo-200 dark:border-indigo-800 bg-card p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Character Questionnaire</h3>
                <button type="button" onClick={() => setQuestionnaireOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
              </div>
              <p className="text-xs text-muted-foreground">
                {readyCharacterCount} of {characterProfiles.length} major character profiles ready{skippedCharacterCount > 0 ? `; ${skippedCharacterCount} skipped` : ""}
              </p>
              <label className="block text-xs text-muted-foreground">
                Character{pendingCharacterProfiles.length > 0 ? " (pending only)" : ""}
                <select
                  value={selectedProfile?.name ?? questionnaireCharacter}
                  onChange={(event) => {
                    setQuestionnaireCharacter(event.target.value);
                    setQuestionnaireStep(0);
                  }}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  {questionnaireChoices.map(({ name }) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <div className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Question {questionnaireStep + 1} of {CHARACTER_QUESTIONS.length} · {question.label}</div>
              <p className="text-sm font-medium text-foreground">{question.question}</p>
              {selectedProfile && readStoryBasis(selectedProfile.body) && (
                <p className="rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                  {readStoryBasis(selectedProfile.body)}
                </p>
              )}
              <div className="space-y-1.5">
                {suggestions.map((suggestion, index) => {
                  const optionId = "suggestion-" + index;
                  const selected = selectedAnswer === optionId;
                  return (
                    <button
                      key={optionId}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setAnswerSelections((current) => ({ ...current, [answerSelectionKey]: optionId }));
                        setCharacterDrafts((current) => ({
                          ...current,
                          [activeQuestionnaireCharacter]: { ...(current[activeQuestionnaireCharacter] ?? draft), [question.key]: suggestion.answer },
                        }));
                      }}
                      className={selected ? "block w-full rounded border border-indigo-500 bg-indigo-50 px-2.5 py-2 text-left text-xs dark:bg-indigo-950/40" : "block w-full rounded border border-border bg-background px-2.5 py-2 text-left text-xs hover:bg-muted"}
                    >
                      <span className="block font-semibold">{suggestion.title}</span>
                      <span className="mt-0.5 block text-muted-foreground">{suggestion.answer}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={selectedAnswer === "manual"}
                  onClick={() => {
                    const alreadyManual = selectedAnswer === "manual";
                    setAnswerSelections((current) => ({ ...current, [answerSelectionKey]: "manual" }));
                    if (!alreadyManual) {
                      setCharacterDrafts((current) => ({
                        ...current,
                        [activeQuestionnaireCharacter]: { ...(current[activeQuestionnaireCharacter] ?? draft), [question.key]: "" },
                      }));
                    }
                  }}
                  className={selectedAnswer === "manual" ? "w-full rounded border border-indigo-500 bg-indigo-50 px-2.5 py-2 text-left text-xs font-medium dark:bg-indigo-950/40" : "w-full rounded border border-border bg-background px-2.5 py-2 text-left text-xs font-medium hover:bg-muted"}
                >
                  Write my own answer
                </button>
              </div>
              {selectedAnswer && (
                <label className="block text-xs text-muted-foreground">
                  Your answer
                  <textarea
                    value={draft[question.key]}
                    onChange={(event) => setCharacterDrafts((current) => ({
                      ...current,
                      [activeQuestionnaireCharacter]: { ...(current[activeQuestionnaireCharacter] ?? draft), [question.key]: event.target.value },
                    }))}
                    onKeyDown={handleTextareaLineMoveKeyDown}
                    rows={question.key === "sampleDialogue" || question.key === "relationships" ? 4 : 3}
                    className="mt-1 w-full resize-y rounded border border-border bg-background px-2.5 py-2 text-sm text-foreground"
                  />
                </label>
              )}
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setQuestionnaireStep((step) => Math.max(0, step - 1))} disabled={questionnaireStep === 0} className="rounded border border-border px-2.5 py-1 text-xs disabled:opacity-40">Back</button>
                <button type="button" onClick={() => void handleSkipCharacterProfile()} className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">Skip</button>
                {questionnaireStep < CHARACTER_QUESTIONS.length - 1 ? (
                  <button type="button" onClick={() => setQuestionnaireStep((step) => step + 1)} disabled={!draft[question.key].trim()} className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Next</button>
                ) : (
                  <button type="button" onClick={() => void handleSaveCharacterProfile()} disabled={!isCompleteCharacterDraft(draft)} className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Save Profile</button>
                )}
              </div>
            </section>
          );
        })()}

        {/* Empty state */}
        {activeTab.type !== "characters" && history.length === 0 && messages.length === 0 && !isStreaming && (
          <div className="py-8 text-center text-[13px] text-muted-foreground">
            {plotLabActive
              ? "Ask Levi to scan Plot 1 and Predefined Episode 1, then confirm the next story decision one question at a time."
              : "Click an action above to start, or type a prompt below."}
          </div>
        )}

        {/* Full history */}
        {activeTab.type !== "characters" && history.map((entry, i) => {
          if (entry.type === "mode-change") {
            return (
              <div key={`mc-${i}`} className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-orange-300" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 whitespace-nowrap">
                  {getModeLabel(entry.mode)}
                </span>
                <div className="flex-1 h-px bg-orange-300" />
              </div>
            );
          }
          return (
            <div
              key={`h-${i}`}
              className={entry.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  entry.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-card border border-border text-foreground"
                }`}
              >
                {entry.role === "assistant" ? (
                  <div className="space-y-2">
                    <AssistantMessage
                      content={entry.content}
                      mode={entry.mode}
                      isStreaming={false}
                      actionsEnabled={i === latestActionableHistoryIndex}
                      onPlotLabDecision={entry.mode === "plot_lab_chat" ? handlePlotLabDecision : undefined}
                    />
                    {entry.mode === "plot_lab_save_preview" && i === latestActionableHistoryIndex && (
                      <button
                        type="button"
                        onClick={() => openPlotLabSave(entry.content)}
                        className="min-h-11 rounded border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        Save with confirmation
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{entry.content}</div>
                )}
              </div>
            </div>
          );
        })}

        {/* Active aiJob (Create Pre-defined Episode) */}
        {aiJob.state.status !== "idle" && !(activeTab.type === "characters" && aiJob.state.kind === "prepare_character_questionnaire" && aiJob.state.status === "completed") && (
          <>
            {aiJob.state.kind && (
              <div className="flex justify-end">
                <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-indigo-600 text-white">
                  {JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind}
                </div>
              </div>
            )}
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-card border border-indigo-200 dark:border-indigo-800 text-foreground space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                  <span className="text-indigo-700">{aiJob.state.kind ? (JOB_LABELS[aiJob.state.kind] ?? aiJob.state.kind) : "AI"}</span>
                  <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-indigo-700 dark:text-indigo-300 normal-case capitalize">
                    {aiJob.state.status}
                  </span>
                </div>
                {aiJob.state.error && (
                  <div className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{aiJob.state.error}</div>
                )}
                {aiJob.state.kind === "prepare_character_questionnaire" && aiJob.state.status !== "failed" && (
                  <p className="text-xs text-muted-foreground">The major cast is being identified from the plot. Questionnaire answers stay in this assistant; only the finished profile is saved in Characters.</p>
                )}
                {aiJob.state.output && aiJob.state.kind !== "prepare_character_questionnaire" && (
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-foreground">
                    {stripTagsForDisplay(aiJob.state.output)}
                  </pre>
                )}
                {(aiJob.state.status === "starting" || aiJob.state.status === "running") && !aiJob.state.output && (
                  <div className="flex items-center gap-2 text-xs text-indigo-600">
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                    Generating
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {(aiJob.state.status === "starting" || aiJob.state.status === "running") && (
                    <button onClick={aiJob.cancel} className="flex-1 rounded-md border border-red-200 dark:border-red-800 bg-card px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                      Cancel
                    </button>
                  )}
                  {aiJob.state.status === "completed" && aiJob.state.output && (
                    <>
                      {aiJob.state.kind !== "prepare_character_questionnaire" && (
                        <>
                          <button onClick={handleDiscardJob} className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
                            Discard
                          </button>
                          <button
                            onClick={handleApplyJob}
                            disabled={isApplyingJob}
                            className="flex-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isApplyingJob ? "Applying..." : "Append to Workbook"}
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {(aiJob.state.status === "failed" || aiJob.state.status === "cancelled") && (
                    <button onClick={aiJob.reset} className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Live streaming output */}
        {activeTab.type !== "characters" && isStreaming && isPlotLabMode(mode) && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground">
              <div className="flex items-center gap-3">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
                <span className="text-sm leading-6 text-muted-foreground">
                  Levi is reading the saved context and preparing the next clean decision.
                </span>
              </div>
            </div>
          </div>
        )}
        {activeTab.type !== "characters" && isStreaming && streamingText && !isPlotLabMode(mode) && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg px-3 py-2 text-sm bg-card border border-border text-foreground">
              <AssistantMessage content={streamingText} mode={mode} isStreaming={true} />
            </div>
          </div>
        )}

        {/* Waiting indicator */}
        {activeTab.type !== "characters" && isStreaming && !streamingText && !isPlotLabMode(mode) && (
          <div className="flex items-center gap-2 py-2 text-indigo-600">
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {notice}
          </div>
        )}
      </div>

      {/* ─── Drag handle ─── */}
      <div
        onMouseDown={handleResizeStart}
        className="group flex h-2.5 flex-shrink-0 cursor-ns-resize items-center justify-center bg-muted hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors select-none"
        title="Drag to resize"
      >
        <div className="h-0.5 w-8 rounded-full bg-border group-hover:bg-indigo-400 transition-colors" />
      </div>

      {/* ─── Input panel ─── */}
      {activeTab.type !== "characters" && (
      <div
        style={{ height: inputPanelHeight }}
        className="flex flex-shrink-0 flex-col border-t border-border px-3 pt-2 pb-2 gap-2 overflow-hidden"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={plotLabActive ? "Chat with Levi..." : characterProfilesComplete ? "What would you like to do?" : "Complete character profiles to unlock AI agents."}
          disabled={isStreaming || (!plotLabActive && !characterProfilesComplete)}
          className={`min-h-0 flex-1 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none transition-colors ${
            isStreaming
              ? "border-border bg-muted text-muted-foreground cursor-not-allowed"
              : "border-border bg-card"
          }`}
          onKeyDown={(e) => {
            if (handleTextareaLineMoveKeyDown(e)) return;
            if (e.key === "Enter") {
              if (sendOnEnter && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                handleSubmit();
              } else if (!sendOnEnter && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isStreaming || (!plotLabActive && !characterProfilesComplete) || !input.trim()}
          className="w-full flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {isStreaming ? "Generating..." : "Send"}
        </button>
        <div className="flex flex-shrink-0 justify-center">
          <div className="flex rounded-full border border-border overflow-hidden text-xs">
            <button
              onClick={() => { setSendOnEnter(false); localStorage.setItem("ai-send-on-enter", "false"); }}
              className={`px-3 py-1 transition-colors ${!sendOnEnter ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium" : "bg-card text-muted-foreground hover:text-muted-foreground"}`}
            >
              ⌘+Enter
            </button>
            <button
              onClick={() => { setSendOnEnter(true); localStorage.setItem("ai-send-on-enter", "true"); }}
              className={`px-3 py-1 transition-colors border-l border-border ${sendOnEnter ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium" : "bg-card text-muted-foreground hover:text-muted-foreground"}`}
            >
              Enter
            </button>
          </div>
        </div>
      </div>
      )}
      {plotLabSaveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-background p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Confirm system-of-record save</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  This will append to {PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]} after confirmation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlotLabSaveOpen(false)}
                className="text-lg leading-none text-muted-foreground hover:text-foreground"
              >
                &times;
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Save as
                <select
                  value={plotLabSaveKind}
                  onChange={(event) => setPlotLabSaveKind(event.target.value as PlotLabSaveKind)}
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                >
                  {Object.entries(PLOT_LAB_SAVE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              {(plotLabSaveKind === "episode_sketch_lock" || plotLabSaveKind === "final_plot_commit") && (
                <label className="block text-xs font-medium text-muted-foreground">
                  Episode number
                  <input
                    value={plotLabEpisodeNumber}
                    onChange={(event) => setPlotLabEpisodeNumber(event.target.value.replace(/[^\d]/g, ""))}
                    className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    placeholder="Optional"
                  />
                </label>
              )}
              <label className="block text-xs font-medium text-muted-foreground">
                Text to save
                <textarea
                  value={plotLabSaveText}
                  onChange={(event) => setPlotLabSaveText(event.target.value)}
                  onKeyDown={handleTextareaLineMoveKeyDown}
                  rows={8}
                  className="mt-1 w-full resize-y rounded border border-border bg-background px-2.5 py-2 text-sm text-foreground"
                />
              </label>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Destination: {PLOT_LAB_DESTINATION_LABELS[plotLabSaveKind]}. This is the double-confirm step before Plot Lab changes a canonical tab.
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPlotLabSaveOpen(false)}
                  disabled={isPlotLabSaving}
                  className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmPlotLabSave()}
                  disabled={isPlotLabSaving || !plotLabSaveText.trim()}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isPlotLabSaving ? "Saving..." : "Confirm save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Assistant message renderer ───

function AssistantMessage({
  content,
  mode,
  isStreaming,
  actionsEnabled = true,
  onPlotLabDecision,
}: {
  content: string;
  mode: Mode;
  isStreaming: boolean;
  actionsEnabled?: boolean;
  onPlotLabDecision?: (decisionText: string, sourceAssistantText?: string) => void;
}) {
  const displayContent = normalizeAssistantDisplayContent(content);
  if (!displayContent) return null;
  const plotLabChoices =
    mode === "plot_lab_chat" && !isStreaming && actionsEnabled && onPlotLabDecision
      ? parsePlotLabChoices(displayContent)
      : null;
  const quickChoices =
    mode === "plot_lab_chat" && !isStreaming && actionsEnabled && onPlotLabDecision
      ? parseInlinePlotLabQuickChoices(displayContent)
      : [];
  if (plotLabChoices) {
    const extraQuickChoices = quickChoices.filter(
      (quick) => !plotLabChoices.choices.some((choice) => choice.key.toLowerCase() === quick.key.toLowerCase())
    );
    return (
      <div className="space-y-3">
        {plotLabChoices.prompt && (
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-foreground">{plotLabChoices.prompt}</div>
        )}
        <div className="space-y-2 rounded-md border border-border bg-background/70 p-2">
          <div className="px-1 text-[11px] font-semibold uppercase text-muted-foreground">Choose next</div>
          {plotLabChoices.choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => onPlotLabDecision?.(choice.response, content)}
              className="group block min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950/30"
            >
              <span className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                  {choice.key}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{choice.label}</span>
                  {choice.detail && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{choice.detail}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
        {plotLabChoices.after && (
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{plotLabChoices.after}</div>
        )}
        {onPlotLabDecision && extraQuickChoices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {extraQuickChoices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                onClick={() => {
                  if (choice.response) onPlotLabDecision(choice.response, content);
                }}
                className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (quickChoices.length > 0) {
    return (
      <div className="space-y-3">
        <div className="whitespace-pre-wrap text-[13px] leading-6 text-foreground">{displayContent}</div>
        <div className="flex flex-wrap gap-2">
          {quickChoices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => {
                if (choice.response) onPlotLabDecision?.(choice.response, content);
              }}
              className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950/30"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap text-[13px] leading-6">
      {displayContent}
      {isStreaming && (
        <span className="inline-block ml-1 h-3 w-1.5 bg-indigo-500 animate-pulse" />
      )}
    </div>
  );
}
