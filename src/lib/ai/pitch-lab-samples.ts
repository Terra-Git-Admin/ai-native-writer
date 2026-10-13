export const PITCH_LAB_SAMPLE_TITLE_PREFIX = "[Sample] ";

export function isPitchLabSampleMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.PITCH_LAB_USE_REAL_AI === "true") return false;
  return process.env.PITCH_LAB_USE_SAMPLES === "true";
}

type SampleInput = {
  generationType: "framework" | "adaptation";
  adaptationStyle: "close" | "loose";
  sourceTitle: string;
  selectedPremise?: string;
};

export type PitchLabSamplePremise = {
  title: string;
  premiseText: string;
  appealLane: string;
  transformationNotes: string;
};

// Prompt/sample title constraints v1.4 (2026-10-13): Pilot Options stay short while varying hook/escalation/cliffhanger type.
const FRAMEWORK_OPTIONS = [
  ["Refusal", "Hook: FL rejects ML's rescue at a clinic fundraiser\nEscalation: His family threatens her ward funding\nCliffhanger: ML offers a live-in nurse contract"],
  ["Witness", "Hook: FL cleaner sees ML destroy evidence\nEscalation: A blackout traps her with his enemies\nCliffhanger: ML arrives before they open her cart"],
  ["Leverage", "Hook: FL debt counselor blocks ML's marriage deal\nEscalation: Her shelter account is frozen\nCliffhanger: ML offers fiancee status for protection"],
  ["Exposure", "Hook: FL singer catches a bribe backstage\nEscalation: The family frames her as extortionist\nCliffhanger: ML claims she is his wife"],
] as const;

const ADAPTATION_TITLES = ["Floodgate", "Runaway", "Last Line", "Blackout"] as const;

const ADAPTATION_VARIANTS = [
  ["ER nurse", "fire investigator", "a shuttered seaside hotel"],
  ["wedding planner", "divorce lawyer", "an empty wedding venue"],
  ["night bus driver", "missing-person detective", "the last line through downtown"],
  ["small-town pharmacist", "undercover officer", "a pharmacy during a blackout"],
] as const;

const FRAMEWORK_PREMISES: PitchLabSamplePremise[] = [
  { title: "Debt Bride", premiseText: "FL debt counselor blocks ML heir's forced-marriage contract, then needs his name to save her shelter.", appealLane: "status leverage", transformationNotes: "Short contract fantasy with immediate bargain pressure." },
  { title: "Fireline", premiseText: "FL safety inspector saves reckless ML firefighter, then must prove he did not start the blaze.", appealLane: "competence collision", transformationNotes: "Competence romance with crisis-born dependence." },
  { title: "Wrong Verdict", premiseText: "FL court clerk finds proof ML lawyer's family hid, making her his weakest witness and only leverage.", appealLane: "legal leverage", transformationNotes: "Truth access creates reluctant alliance." },
  { title: "Night Line", premiseText: "FL night bus driver protects ML heir from an ambush, then is blamed for helping him vanish.", appealLane: "public danger", transformationNotes: "Ordinary duty turns into romantic danger." },
  { title: "Storm Key", premiseText: "FL caretaker shelters wounded ML stranger during a typhoon, then finds his key opens her family's sealed room.", appealLane: "rescue suspicion", transformationNotes: "Rescue intimacy with family mystery." },
  { title: "False Guest", premiseText: "FL wedding planner is mistaken for ML's fiancee, and both need the lie to survive his mother's trap.", appealLane: "mistaken access", transformationNotes: "Public performance makes the romance playable." },
  { title: "Open Mic", premiseText: "FL lounge singer records ML donor's coercion, then must perform for the same room to expose him.", appealLane: "voice trap", transformationNotes: "Performance pressure gives her active power." },
  { title: "Cold Room", premiseText: "FL chef locks herself in with ML investor to save her restaurant stock and discovers his secret debt.", appealLane: "ambition pressure", transformationNotes: "Business pressure turns intimate fast." },
];

const ADAPTATION_PREMISES: PitchLabSamplePremise[] = [
  { title: "Cold Room", premiseText: "FL cafe owner saves ML investor during a freezer sabotage, then needs his money before he owns her.", appealLane: "competence under pressure", transformationNotes: "Preserves attachment while changing job and obligation." },
  { title: "Fire Audit", premiseText: "FL inspector rescues ML contractor from a fire, then must decide whether his company caused it.", appealLane: "dangerous gratitude", transformationNotes: "Transforms caregiver surface into workplace pressure." },
  { title: "Last Table", premiseText: "FL diner owner hides wounded ML regular, then learns his enemies booked every table.", appealLane: "protective ambiguity", transformationNotes: "Keeps nerve-plus-charm pressure in public space." },
  { title: "Open Stage", premiseText: "FL stage manager can expose ML donor's coercion only by keeping his gala running.", appealLane: "public coercion", transformationNotes: "Replaces private care with performance pressure." },
  { title: "Storm Escort", premiseText: "FL driver saves ML passenger during a storm, then police accuse her of helping his escape.", appealLane: "accidental alliance", transformationNotes: "Changes occupation stakes and keeps her active." },
  { title: "False Note", premiseText: "FL pianist reads ML's hidden account code in sheet music and becomes useful to the wrong family.", appealLane: "skill trap", transformationNotes: "Keeps performance-world charge." },
  { title: "Back Room", premiseText: "FL cashier handles ML VIP's secret payment, then his missing money makes her disposable.", appealLane: "status reversal", transformationNotes: "Preserves dangerous male pressure but keeps heroine active." },
  { title: "Locked Lens", premiseText: "FL wedding photographer captures ML family's lie, then must fake loyalty to leave alive.", appealLane: "evidence trap", transformationNotes: "Transforms rescue into visual evidence pressure." },
];

export function buildPitchLabSamplePremises(input: SampleInput): PitchLabSamplePremise[] {
  return input.generationType === "framework" ? FRAMEWORK_PREMISES : ADAPTATION_PREMISES;
}

export function buildPitchLabSampleIdeas(input: SampleInput): { title: string; ideaText: string }[] {
  if (input.selectedPremise) {
    const premise = input.selectedPremise.replace(/\s+/g, " ").trim();
    const lowerPremise = premise.toLocaleLowerCase();
    if (lowerPremise.includes("truth") || lowerPremise.includes("justice")) {
      return [
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Live File`, ideaText: "Hook: FL court clerk finds ML's missing file\nEscalation: The judge's aide calls her the leak\nCliffhanger: She names the source live" },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Witness Seat`, ideaText: "Hook: FL witness interrupts ML's press conference\nEscalation: His family calls her paid\nCliffhanger: ML asks her to testify as fiancee" },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Court Lock`, ideaText: "Hook: FL and ML are locked in archives\nEscalation: Her badge opens the evidence room\nCliffhanger: ML finds evidence in her lunchbox" },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Plea Trap`, ideaText: "Hook: FL spots ML's false plea offer\nEscalation: Signing saves her family\nCliffhanger: She tears it up on camera" },
      ];
    }
    if (lowerPremise.includes("publicly accountable") || lowerPremise.includes("ordinary choice")) {
      return [
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Last Stop`, ideaText: "Hook: FL lets wounded ML board late\nEscalation: Cameras tag her as kidnapper\nCliffhanger: He handcuffs himself to her wheel" },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Line Nine`, ideaText: "Hook: FL refuses ML's checkpoint bribe\nEscalation: A fake officer boards\nCliffhanger: She drives into the closed tunnel" },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Night Fare`, ideaText: "Hook: FL recognizes ML's panic code\nEscalation: Every driver cancels\nCliffhanger: ML asks her to pose as fiancee" },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Terminal Light`, ideaText: "Hook: FL hides ML at lost property\nEscalation: His watch exposes her booth\nCliffhanger: Her address fills the station screens" },
      ];
    }
    return FRAMEWORK_OPTIONS.map(([title, ideaText]) => ({
      title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`,
      ideaText,
    }));
  }

  if (input.generationType === "framework") {
    return FRAMEWORK_OPTIONS.map(([title, ideaText]) => ({
      title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`,
      ideaText,
    }));
  }

  return ADAPTATION_VARIANTS.map(([lead, counterpart], index) => {
    const title = ADAPTATION_TITLES[index];

    const ideaText = input.adaptationStyle === "close"
      ? `Hook: FL ${lead} saves ML ${counterpart}\nEscalation: The witnesses blame her\nCliffhanger: He offers protection as fiancee`
      : `Hook: FL ${lead} catches ML ${counterpart}'s secret\nEscalation: Her fix exposes his family lie\nCliffhanger: He names her as alibi`;
    return { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`, ideaText };
  });
}
