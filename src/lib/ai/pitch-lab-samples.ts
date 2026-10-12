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

// Prompt/sample title constraints v1.2 (2026-10-12): every title is one or two words.
const FRAMEWORK_ROUTES = [
  ["Refusal", "Build a route around a heroine whose clean refusal exposes a powerful lead's weakness. The pilot should promise attraction through integrity, public consequence, and a later concrete situation where saying no changes the power balance."],
  ["Witness", "Build a route around public misreading and private recognition. The heroine looks guilty or foolish to everyone else, while the opposing lead sees she may be the only person with usable access, courage, or truth."],
  ["Leverage", "Build a route around mismatched status: the heroine has one practical advantage the powerful lead cannot buy. The pilot should promise bargaining, suspicion, and romantic dependence before Shortlist Studio chooses the exact pressure object."],
  ["Exposure", "Build a route around image versus truth. The heroine can damage a family's, company's, or celebrity's perfect surface, and the opposing lead must decide whether to silence, use, or protect her."],
] as const;

const ADAPTATION_TITLES = ["Floodgate", "Runaway", "Last Route", "Blackout"] as const;

const ADAPTATION_VARIANTS = [
  ["ER nurse", "fire investigator", "a shuttered seaside hotel"],
  ["wedding planner", "divorce lawyer", "an empty wedding venue"],
  ["night bus driver", "missing-person detective", "the last route through downtown"],
  ["small-town pharmacist", "undercover officer", "a pharmacy during a blackout"],
] as const;

const FRAMEWORK_PREMISES: PitchLabSamplePremise[] = [
  { title: "Debt Bride", premiseText: "A working-class heroine is pulled toward a powerful family that treats marriage as leverage, promising romance where love, debt, and public status keep changing who owns the bargain.", appealLane: "status leverage", transformationNotes: "Frames the contract fantasy without choosing the incident." },
  { title: "Fireline", premiseText: "A careful rule-follower and a reckless protector keep colliding because each crisis proves the other's competence is both dangerous and irresistible.", appealLane: "competence collision", transformationNotes: "Keeps workplace heat while leaving the arena open." },
  { title: "Wrong Verdict", premiseText: "A low-status woman with hidden access to truth is forced into an alliance with a colder, higher-status defender, promising justice, family secrets, and reluctant dependence.", appealLane: "legal leverage", transformationNotes: "Preserves procedural pressure without plotting a file swap." },
  { title: "Last Route", premiseText: "A woman whose job makes her publicly accountable keeps getting trapped with a privileged man whose secrets make every ordinary choice look suspicious.", appealLane: "public danger", transformationNotes: "Keeps moving public pressure without choosing the vehicle incident." },
  { title: "Storm Key", premiseText: "A guarded caretaker must decide whether sheltering a stranger is rescue, betrayal, or the first clue to a family wound she has avoided for years.", appealLane: "rescue suspicion", transformationNotes: "Uses intimate storm pressure without an incident reveal." },
  { title: "False Guest", premiseText: "A woman hiding from scandal and a powerful man guarding family image need each other's false identity, promising public performance, private recognition, and romantic exposure.", appealLane: "mistaken access", transformationNotes: "Keeps ceremony stakes but delays the collision." },
  { title: "Open Mic", premiseText: "A woman whose voice is her only power becomes dangerous to a man who controls the room, promising secrets exposed through performance, sound, and reputation.", appealLane: "voice trap", transformationNotes: "Audio pressure becomes a broad promise, not a fixed call." },
  { title: "Cold Room", premiseText: "A practical heroine protecting her livelihood clashes with a status figure who can ruin or save it, promising competence, suspicion, and attraction under business pressure.", appealLane: "ambition pressure", transformationNotes: "Keeps food-world stakes without a freezer incident." },
];

const ADAPTATION_PREMISES: PitchLabSamplePremise[] = [
  { title: "Cold Room", premiseText: "A small-business heroine and a powerful investor are bound by crisis-born gratitude, promising attraction where help always risks ownership.", appealLane: "competence under pressure", transformationNotes: "Preserves attachment while changing job, setting, and obligation." },
  { title: "Fire Audit", premiseText: "A rule-bound heroine and a reckless protector keep saving each other in ways that can end their careers, promising gratitude, blame, and public competence.", appealLane: "dangerous gratitude", transformationNotes: "Transforms caregiver surface into workplace pressure." },
  { title: "Last Table", premiseText: "A woman protecting her everyday kingdom attracts a dangerous regular whose charm may be shelter or threat, promising intimacy under public pressure.", appealLane: "protective ambiguity", transformationNotes: "Keeps nerve-plus-charm pressure while changing the trap." },
  { title: "Open Stage", premiseText: "A woman who manages public performance becomes the only person who can expose a powerful donor's coercion, promising romance through spectacle and risk.", appealLane: "public coercion", transformationNotes: "Replaces private care with performance pressure." },
  { title: "Storm Escort", premiseText: "A competent woman helps a dangerous passenger and becomes implicated by that help, promising accidental alliance, suspicion, and storm-bound trust.", appealLane: "accidental alliance", transformationNotes: "Changes occupation stakes and defers the cliffhanger." },
  { title: "False Note", premiseText: "A heroine's rare skill makes her useful to a powerful man with hidden money trouble, promising romance where performance, class, and evidence keep crossing.", appealLane: "skill trap", transformationNotes: "Keeps performance-world charge without caregiver logic." },
  { title: "Back Room", premiseText: "A woman who handles other people's money becomes necessary to a dangerous VIP, promising status reversal where usefulness can turn into disposability or desire.", appealLane: "status reversal", transformationNotes: "Preserves dangerous male pressure but keeps heroine active." },
  { title: "Locked Lens", premiseText: "A woman paid to preserve family image becomes the person who can destroy it, promising wedding glamour, visual evidence, and forbidden alliance.", appealLane: "evidence trap", transformationNotes: "Transforms rescue into visual evidence pressure." },
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
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Live File`, ideaText: "Lean into a procedural romance route where the heroine's overlooked access makes her the only person the defender can trust. The pilot should deliver public stakes, family shame, and reluctant alliance before Shortlist Studio chooses the exact record, hearing, or proof mechanism." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Witness Seat`, ideaText: "Shape the route around visible belief: the heroine is used to being ignored until the opposing lead makes her testimony matter. The pilot should promise status reversal, public pressure, and a partnership that risks both families without fixing the opening incident yet." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Court Lock`, ideaText: "Use a contained-pressure route where bureaucracy becomes romantic friction. The heroine and opposing lead need each other's access and nerve, but the exact file, room, or public accusation should be selected later in Shortlist Studio." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Plea Trap`, ideaText: "Build toward a moral-bind route: the heroine can protect herself or help expose a larger wrong. The pilot should carry legal leverage, family consequence, and attraction through competence while leaving the concrete trigger unresolved." },
      ];
    }
    if (lowerPremise.includes("publicly accountable") || lowerPremise.includes("ordinary choice")) {
      return [
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Last Stop`, ideaText: "Take the public-accountability route: the heroine's job makes every choice visible, while the privileged lead's secrets make every request suspicious. The pilot should promise class tension, moving danger, and reluctant dependence without choosing the exact alert or stop." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Route Nine`, ideaText: "Use a route built on bought access versus public duty. The powerful lead can open doors the heroine cannot, she controls the journey he needs, and Shortlist Studio can later decide the concrete schedule, witness, or threat." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Night Fare`, ideaText: "Make the pilot a moral-pressure route where rule-following becomes heroic and inconvenient. The lead's secret should test whether procedure protects people or exposes them, but the exact checkpoint or proof stays open." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Terminal Light`, ideaText: "Choose an atmospheric suspense route: an ordinary public system turns intimate because the heroine understands how it works and the lead understands why someone wants to disappear. Keep the final mechanism for Shortlist Studio." },
      ];
    }
    return FRAMEWORK_ROUTES.map(([title, ideaText]) => ({
      title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`,
      ideaText,
    }));
  }

  if (input.generationType === "framework") {
    return FRAMEWORK_ROUTES.map(([title, ideaText]) => ({
      title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`,
      ideaText,
    }));
  }

  return ADAPTATION_VARIANTS.map(([lead, counterpart, setting], index) => {
    const title = ADAPTATION_TITLES[index];

    const ideaText = input.adaptationStyle === "close"
      ? `Sample placeholder based on "${input.sourceTitle}". Preserve the source's major emotional promise and relationship turns, but recast the heroine as a ${lead} and the male lead as a ${counterpart}. Keep this as a route direction; Shortlist Studio can later choose the exact incident, proof, and final turn.`
      : `Sample placeholder inspired by "${input.sourceTitle}". Keep its central emotional engine, but rebuild the route around a ${lead} and a ${counterpart} with pressure from ${setting}. Their opposing goals should suggest cooperation and suspicion without closing the Episode 1 situation yet.`;
    return { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`, ideaText };
  });
}
