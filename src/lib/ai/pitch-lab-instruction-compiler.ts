export type PitchLabGenerationStage = "ideas" | "routes" | "studio";

export type PitchLabWorldMode = "period_archetypal" | "contemporary" | "modern_adaptation" | "source_locked" | "unspecified";

export type PitchLabInstructionControls = {
  stage: PitchLabGenerationStage;
  worldMode: PitchLabWorldMode;
  roleCues: string[];
  relationshipTropes: string[];
  toneCues: string[];
  routeIntent: "character_profiles" | "setting_variants" | "tone_variants" | "relationship_engines" | "general_routes";
  requiredConstraints: string[];
  avoidGuidance: string[];
  evidence: string[];
};

export type PitchLabQaWarning = {
  code: string;
  message: string;
  evidence?: string;
};

type CompileInput = {
  stage: PitchLabGenerationStage;
  brief?: string;
  instruction?: string;
  selectedIdea?: string;
  carriedContext?: string;
  sourceMaterial?: string;
  generationType?: "framework" | "adaptation";
};

const ROLE_CUES = [
  "princess", "prince", "queen", "king", "duke", "duchess", "knight", "hunter", "warrior", "mage", "witch", "healer", "guard", "noble", "heir", "outcast", "doctor", "lawyer", "teacher", "driver", "chef", "singer",
];

const PERIOD_WORLD_CUES = [
  "royal", "court", "noble", "princess", "prince", "queen", "king", "duke", "duchess", "knight", "hunter", "warrior", "mage", "witch", "curse", "kingdom", "clan", "palace", "forest", "medieval", "ancient", "historical", "mythic", "fantasy", "period", "throne", "village", "exile", "betrothal", "bloodline",
];

const MODERN_ADAPTATION_CUES = [
  "modern", "contemporary", "present-day", "present day", "urban", "modern au", " au ", "adaptation", "reimagining", "reimagine", "pretending", "disguise", "undercover", "fake job",
];

const CONTEMPORARY_SURFACES = [
  "tattoo studio", "laundromat", "coffee shop", "cafe", "barista", "influencer", "startup", "corporate office", "boardroom", "hospital", "clinic", "law firm", "lawyer", "compliance", "regulator", "police station", "campaign", "donors", "apartment building", "rideshare", "subway", "bus route", "social media",
];

const RELATIONSHIP_TROPES = [
  "contract marriage", "marriage of convenience", "fake dating", "arranged marriage", "secret spouse", "enemies to lovers", "enemies-to-lovers", "second chance", "forbidden romance", "revenge affair", "love triangle",
];

const TONE_CUES = [
  "rom com", "rom-com", "romantic comedy", "comedy", "revenge", "thriller", "melodrama", "fantasy", "dark", "sweet", "campy", "historical", "mythic",
];

const EXCLUSION_PATTERN = /\b(?:no|avoid|exclude|without|not)\s+([^,.;\n]+)/gi;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

function collectMatches(text: string, cues: string[]): string[] {
  const normalized = normalize(text);
  return cues.filter((cue) => normalized.includes(normalize(cue).trim()));
}

function collectExclusions(text: string): string[] {
  const exclusions: string[] = [];
  for (const match of text.matchAll(EXCLUSION_PATTERN)) {
    const value = match[1]?.trim();
    if (value) exclusions.push(value);
  }
  return [...new Set(exclusions)];
}

function detectRouteIntent(text: string): PitchLabInstructionControls["routeIntent"] {
  const normalized = normalize(text);
  if (/\b(character|profile|profiles|lead|heroine|male lead|counterlead|pairing|pairings)\b/.test(normalized)) return "character_profiles";
  if (/\b(setting|location|world|arena|place|surface)\b/.test(normalized)) return "setting_variants";
  if (/\b(tone|vibe|genre|comedy|dark|sweet|thriller|melodrama)\b/.test(normalized)) return "tone_variants";
  if (/\b(engine|relationship|dynamic|tension|power)\b/.test(normalized)) return "relationship_engines";
  return "general_routes";
}

function detectWorldMode(input: CompileInput, text: string): PitchLabWorldMode {
  if (input.generationType === "adaptation" && input.sourceMaterial?.trim()) return "source_locked";
  const hasPeriodCue = collectMatches(text, PERIOD_WORLD_CUES).length > 0;
  const hasModernCue = collectMatches(` ${text} `, MODERN_ADAPTATION_CUES).length > 0;
  if (hasPeriodCue && hasModernCue) return "modern_adaptation";
  if (hasPeriodCue) return "period_archetypal";
  if (hasModernCue || collectMatches(text, CONTEMPORARY_SURFACES).length > 0) return "contemporary";
  return "unspecified";
}

export function compilePitchLabInstructions(input: CompileInput): PitchLabInstructionControls {
  const text = [input.brief, input.carriedContext, input.selectedIdea, input.instruction, input.sourceMaterial].filter(Boolean).join("\n");
  const roleCues = collectMatches(text, ROLE_CUES);
  const relationshipTropes = collectMatches(text, RELATIONSHIP_TROPES);
  const toneCues = collectMatches(text, TONE_CUES);
  const exclusions = collectExclusions(text);
  const worldMode = detectWorldMode(input, text);
  const requiredConstraints: string[] = [];
  const avoidGuidance: string[] = [];
  const evidence = [...new Set([...roleCues, ...relationshipTropes, ...toneCues, ...collectMatches(text, PERIOD_WORLD_CUES), ...collectMatches(text, MODERN_ADAPTATION_CUES)])];

  if (worldMode === "period_archetypal") {
    requiredConstraints.push("Preserve the implied period, royal, fantasy, mythic, or archetypal story world.");
    requiredConstraints.push("Treat role words such as princess, hunter, warrior, noble, or healer as real story-world identities.");
    avoidGuidance.push("Avoid random contemporary jobs, institutions, or urban locations unless the writer explicitly asks for a modern adaptation.");
  }
  if (worldMode === "modern_adaptation") {
    requiredConstraints.push("Translate archetypal roles into a coherent modern adaptation and make the translation visible.");
  }
  if (relationshipTropes.length) {
    requiredConstraints.push(`Keep these relationship/trope cues active: ${relationshipTropes.join(", ")}.`);
  }
  if (toneCues.length) {
    requiredConstraints.push(`Keep these tone cues visible: ${toneCues.join(", ")}.`);
  }
  if (input.stage === "ideas") {
    requiredConstraints.push("Idea cards must include visible woman/opposing-lead tension without describing episode plans.");
    avoidGuidance.push("Avoid episode-framing phrases like each episode, episodes promise, series arc, or season.");
  }
  if (input.stage === "routes") {
    if (detectRouteIntent(text) === "character_profiles") {
      requiredConstraints.push("Make each route a distinct lead/counterlead profile pairing.");
    }
    avoidGuidance.push("Avoid route labels such as Runway, Pilot arc, Series arc, or Episodes.");
  }
  exclusions.forEach((exclusion) => avoidGuidance.push(`Avoid: ${exclusion}.`));

  return {
    stage: input.stage,
    worldMode,
    roleCues: [...new Set(roleCues)],
    relationshipTropes: [...new Set(relationshipTropes)],
    toneCues: [...new Set(toneCues)],
    routeIntent: detectRouteIntent(text),
    requiredConstraints,
    avoidGuidance,
    evidence,
  };
}

export function formatPitchLabInstructionControls(controls: PitchLabInstructionControls): string {
  const lines = [
    "INTERPRETED WRITER CONTROLS",
    `- Stage: ${controls.stage}`,
    `- World mode: ${controls.worldMode}`,
    controls.roleCues.length ? `- Role cues: ${controls.roleCues.join(", ")}` : "",
    controls.relationshipTropes.length ? `- Relationship/trope cues: ${controls.relationshipTropes.join(", ")}` : "",
    controls.toneCues.length ? `- Tone cues: ${controls.toneCues.join(", ")}` : "",
    `- Route intent: ${controls.routeIntent}`,
    controls.requiredConstraints.length ? `- Must respect: ${controls.requiredConstraints.join(" | ")}` : "",
    controls.avoidGuidance.length ? `- Avoid: ${controls.avoidGuidance.join(" | ")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function scanPitchLabOutput(controls: PitchLabInstructionControls, stage: PitchLabGenerationStage, outputs: string[]): PitchLabQaWarning[] {
  const warnings: PitchLabQaWarning[] = [];
  const joined = outputs.join("\n\n");
  if (stage === "ideas" && /\b(?:each episode|episodes?\s+(?:promise|deliver|test|surface|show|explore)|across episodes|series arc|season)\b/i.test(joined)) {
    warnings.push({ code: "episode_framing_in_idea", message: "Idea output used episode-plan or series-arc language before the route/studio stages." });
  }
  if (stage === "routes" && /\b(?:Runway|Pilot arc|Series arc|Episodes?)\s*:/i.test(joined)) {
    warnings.push({ code: "arc_label_in_route", message: "Route output used arc/runway labels instead of plain route/profile tension." });
  }
  if (controls.worldMode === "period_archetypal") {
    const modernSurface = CONTEMPORARY_SURFACES.find((cue) => normalize(joined).includes(normalize(cue)));
    if (modernSurface) {
      warnings.push({
        code: "world_period_modernized",
        message: "Output used a contemporary surface even though the input implied a period, royal, fantasy, mythic, or archetypal world.",
        evidence: modernSurface,
      });
    }
  }
  controls.avoidGuidance.forEach((avoid) => {
    const plain = avoid.replace(/^Avoid:\s*/i, "").replace(/\.$/, "").trim();
    if (plain && plain.length <= 60 && normalize(joined).includes(normalize(plain))) {
      warnings.push({ code: "avoid_guidance_appeared", message: `Output may include avoided material: ${plain}.`, evidence: plain });
    }
  });
  return warnings;
}
