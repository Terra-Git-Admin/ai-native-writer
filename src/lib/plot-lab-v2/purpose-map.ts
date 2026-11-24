import type {
  PlotLabConnectedBatch,
  PlotLabPurposeMap,
  PlotLabPurposeUnit,
  PlotLabSessionState,
} from "@/lib/plot-lab-v2/contracts";

export function inferPurposeDestination(session: PlotLabSessionState): number {
  if (session.orientation === "landscape") {
    const source = [session.seed, session.interviewCheckpoint.characterBrief?.monetizationPoint]
      .filter(Boolean)
      .join(" ");
    return /(?:milestone|chapter\s+1\s+unit)\s*5\b/i.test(source) ? 5 : 4;
  }
  const source = [session.seed, session.interviewCheckpoint.characterBrief?.monetizationPoint]
    .filter(Boolean)
    .join(" ");
  return /(?:episode|ep)\s*7\b/i.test(source) ? 7 : 8;
}

export function purposeUnitNumbers(
  orientation: PlotLabSessionState["orientation"],
  monetizationEpisode: number
): number[] {
  const first = orientation === "portrait" ? 2 : 1;
  const last = orientation === "portrait"
    ? Math.min(8, Math.max(7, monetizationEpisode))
    : Math.min(5, Math.max(4, monetizationEpisode));
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export function normalizePurposeMap(
  candidate: PlotLabPurposeMap,
  orientation: PlotLabSessionState["orientation"],
  monetizationEpisode: number
): PlotLabPurposeMap {
  const expected = purposeUnitNumbers(orientation, monetizationEpisode);
  const byNumber = new Map(candidate.units.map((unit) => [unit.number, unit]));
  const units = expected.map((number) => byNumber.get(number)).filter((unit): unit is PlotLabPurposeUnit => Boolean(unit));
  if (units.length !== expected.length) throw new Error("Purpose Planner did not return the required story range.");
  const lines = units.map((unit) => unit.purposeLine.trim().toLocaleLowerCase());
  if (lines.some((line) => !line) || new Set(lines).size !== lines.length) {
    throw new Error("Purpose Planner returned missing or duplicate episode purposes.");
  }
  return {
    format: orientation,
    monetizationEpisode,
    destination: candidate.destination.trim(),
    units: units.map((unit) => ({
      ...unit,
      id: `${orientation === "portrait" ? "ep" : "milestone"}-${unit.number}`,
      purposeLine: unit.purposeLine.trim(),
    })),
    warnings: [...new Set(candidate.warnings ?? [])],
  };
}

export function fallbackPurposeMap(session: PlotLabSessionState): PlotLabPurposeMap {
  const monetizationEpisode = inferPurposeDestination(session);
  const numbers = purposeUnitNumbers(session.orientation, monetizationEpisode);
  const brief = session.interviewCheckpoint.characterBrief;
  const destination = brief?.monetizationPoint?.trim() || session.seed?.trim() || "Deliver the writer's selected monetization turn.";
  const unresolved = brief?.storySoul.unresolvedPressure?.trim() || "the unresolved Episode 1 pressure";
  const functions = [
    ["Episode 1 consequence becomes a contract", "cash the immediate Episode 1 pressure and lock the lead into the continuing story"],
    ["The lead proves a defining quality", "make a consequential attempt that changes what the other characters expect"],
    ["The central relationship changes", "force behavior that creates trust, suspicion, obligation, attraction, or strain"],
    ["A hidden pressure becomes legible", "reframe what the audience or lead understands about the danger"],
    ["The outside world collides with the leads", "bring story-bearing opposition or social pressure into the central engine"],
    ["The lead crosses a threshold", "make a costly commitment that moves the story into the monetization arena"],
    ["The monetization turn lands", `deliver ${destination}`],
  ] as const;
  const selected = functions.slice(functions.length - numbers.length);
  return {
    format: session.orientation,
    monetizationEpisode,
    destination,
    units: numbers.map((number, index) => {
      const [title, move] = selected[index];
      const final = index === numbers.length - 1;
      const next = final ? destination : selected[index + 1][0];
      return {
        id: `${session.orientation === "portrait" ? "ep" : "milestone"}-${number}`,
        number,
        title,
        purposeLine: `${title}: The protagonist must ${move}, leaving a concrete changed state that forces ${next.toLowerCase()}.`,
        incomingPressure: index === 0 ? unresolved : `The prior unit's changed state forces ${title.toLowerCase()}.`,
        decisiveMove: move,
        stateDelta: final ? destination : `The story can no longer return to its state before ${title.toLowerCase()}.`,
        outgoingHook: next,
        dominantFunction: final ? "paywall_turn" : "causal_progression",
        changedDimensions: final ? ["plot_objective", "power_opposition"] : ["plot_objective"],
        scenePhase: "Resolve the inherited pressure before advancing the dramatic situation.",
        characterFunctions: ["protagonist: makes the consequential move"],
        skeletonElementsUsed: final ? brief?.requiredSkeletonElements ?? [] : [],
      };
    }),
    warnings: ["Purpose Planner returned incomplete structure; Levi preserved a distinct reviewable purpose for every unit."],
  };
}

export function fallbackBatchFromPurposeMap(
  purposeMap: PlotLabPurposeMap,
  version: number,
  warning: string
): PlotLabConnectedBatch {
  return {
    format: purposeMap.format,
    version,
    units: purposeMap.units.map((unit) => ({
      purposeUnitId: unit.id,
      number: unit.number,
      title: unit.title,
      cause: unit.incomingPressure,
      soulConnection: unit.purposeLine,
      episodeFunction: unit.dominantFunction,
      timePhase: unit.scenePhase,
      locationFunction: unit.scenePhase,
      characterChoice: unit.decisiveMove,
      consequence: unit.stateDelta,
      nextPressure: unit.outgoingHook,
      emotionalChange: unit.stateDelta,
      endingTurn: unit.outgoingHook,
      cliffhangerType: unit.dominantFunction,
      relationshipChange: unit.stateDelta,
      antagonistPressure: unit.outgoingHook,
      fidelityProof: "Expanded from the writer-approved purpose unit.",
      skeletonElementsUsed: unit.skeletonElementsUsed,
      revelationPurpose: "",
      visiblePlot: unit.purposeLine,
    })),
    seedCoverage: [...new Set(purposeMap.units.flatMap((unit) => unit.skeletonElementsUsed))].map((element) => ({
      element,
      unitNumbers: purposeMap.units.filter((unit) => unit.skeletonElementsUsed.includes(element)).map((unit) => unit.number),
    })),
    warnings: [...new Set([...purposeMap.warnings, warning])],
  };
}
