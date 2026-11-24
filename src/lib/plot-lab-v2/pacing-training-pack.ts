// PLOT LAB PURPOSE PACING PACK v1.0
// CHANGE LOG
// v1.0 - 2026-11-24: Normalize all seven pre-monetization training plots into compact purpose rhythms.

export const PLOT_LAB_PACING_TRAINING_PACK_VERSION = "purpose-pacing-v1-2026-11-24";

export interface PlotLabPacingReference {
  story: string;
  monetizationEpisode: 7 | 8;
  rhythm: string[];
}

/**
 * Craft calibration only. These compact rhythms teach movement and handoffs;
 * they are never current-document canon and must not be copied as story content.
 */
export const PLOT_LAB_PACING_REFERENCES: PlotLabPacingReference[] = [
  {
    story: "Farm Girl",
    monetizationEpisode: 7,
    rhythm: [
      "Enter workplace and receive the first task",
      "Prove unexpected competence and create romantic contact",
      "Bring the ex into the romantic moment as workplace pressure",
      "Resolve the confrontation and secure the heroine's position",
      "Apply sabotage that forces the heroine to seek functional help",
      "Deliver the work under concealed uncertainty and end on evaluation",
    ],
  },
  {
    story: "Nurse",
    monetizationEpisode: 7,
    rhythm: [
      "Turn a coerced offer into a contract and activate family resistance",
      "Move into the crime world while an outside antagonist confirms pursuit",
      "Humanize the dangerous lead, deepen attraction, and expose containment",
      "Collide the heroine's private vulnerability with her new protectors",
      "Clarify family loyalties while unseen pursuit closes in",
      "Pivot domestic character play into an immediate armed attack",
    ],
  },
  {
    story: "Prince",
    monetizationEpisode: 8,
    rhythm: [
      "Defend the unconscious prince and force the attackers to retreat",
      "Nurse him awake, build intimacy, and reveal apparent amnesia",
      "Use flashback to reveal the deception to the audience while the heroine remains unaware",
      "Activate palace and family pressure moving toward the leads",
      "Deepen romance before the prince widens his lie under public pressure",
      "Plant suspicion and make the heroine choose entry into the royal world",
      "Cross into the castle and deliver a renewed assassination attack",
    ],
  },
  {
    story: "Ring",
    monetizationEpisode: 8,
    rhythm: [
      "Trade proof for sanctuary and end with physical collapse",
      "Turn rescue into awkward intimacy and unexpected care",
      "Let the heroine overhear the heir's consequential moral choice",
      "Make her respond through action while the family detects a deeper mystery",
      "Increase identity suspicion and reveal external surveillance",
      "Build romance in a new setting before the threat becomes visible to her",
      "Convert the public family event into a coordinated trap",
    ],
  },
  {
    story: "Florist",
    monetizationEpisode: 8,
    rhythm: [
      "Survive the search, protect the stranger, and reveal his hidden agenda to the audience",
      "Create forced collaboration after opposition removes the heroine's help",
      "Use shared work to build attraction while surveillance captures them",
      "Collide debt pressure with the man's concealed authority and a second hidden agenda",
      "Move into the gala world and separate the leads through his mission",
      "Let the heroine follow and discover him operating underground",
      "Trap them together as they witness violence and risk discovery",
    ],
  },
  {
    story: "I Object",
    monetizationEpisode: 8,
    rhythm: [
      "Complete the abduction and expose the heroine's family's true priority",
      "Turn that emotional wound into an active escape attempt that fails",
      "Contrast the captor's care with a murder order he refuses",
      "Create a protection bargain and a public route back to the fiancé",
      "Show conflicted attraction as the handoff begins",
      "Complete the handoff, then let one detail expose the fiancé's betrayal",
      "Intercut the poisoning attempt with the rescuer racing back",
    ],
  },
  {
    story: "Lift",
    monetizationEpisode: 8,
    rhythm: [
      "Enter the dangerous household through a lucrative job contract",
      "Turn the children's warning into a humiliating first test",
      "Expose the heroine's need and make one child feel consequential guilt",
      "Prove the heroine chose to stay and reveal the male lead's family sacrifice",
      "Build attraction before his dangerous power enters her personal problem",
      "Let her challenge that power and change how he understands his family role",
      "Earn family acceptance before outside forces attack the celebration",
    ],
  },
];

export const PLOT_LAB_PACING_FRAMEWORK = {
  unit: ["incoming pressure", "consequential move", "changed story state", "outgoing hook"],
  functions: ["contract", "proof", "bond_or_strain", "reveal_or_reframe", "pressure_or_collision", "commit_or_transition", "paywall_turn"],
  dimensions: ["plot_objective", "relationship", "knowledge", "power_opposition", "world_time_location", "character_commitment"],
} as const;
