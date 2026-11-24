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
  candidate: {
    units: Array<{ title?: string; purposeLine?: string }>;
  },
  orientation: PlotLabSessionState["orientation"],
  monetizationEpisode: number,
  context?: {
    destination?: string;
    unresolvedPressure?: string;
    requiredSkeletonElements?: string[];
  }
): PlotLabPurposeMap {
  const expected = purposeUnitNumbers(orientation, monetizationEpisode);
  const units = Array.isArray(candidate.units) ? candidate.units : [];
  if (units.length !== expected.length) throw new Error("Purpose Planner did not return the required story range.");
  const lines = units.map((unit) => unit.purposeLine?.trim() ?? "");
  if (lines.some((line) => !line)) throw new Error("Purpose Planner returned an empty episode purpose.");
  const instructionIndex = units.findIndex((unit) => {
    const line = unit.purposeLine?.trim() ?? "";
    return /\bleaving a concrete changed state that forces\b/i.test(line)
      || /\b(?:episode 1 consequence becomes a contract|the lead proves a defining quality|the central relationship changes|a hidden pressure becomes legible|the outside world collides with the leads|the lead crosses a threshold|the monetization turn lands)\b/i.test(line);
  });
  if (instructionIndex >= 0) {
    throw new Error(`Purpose Planner returned planning instructions instead of an Episode ${expected[instructionIndex]} story event.`);
  }
  const destination = context?.destination?.trim() || "Deliver the writer's selected monetization turn.";
  const duplicateWarning = new Set(lines.map((line) => line.toLocaleLowerCase())).size !== lines.length
    ? ["Some purpose lines repeat. Review the progression before approving the map."]
    : [];
  return {
    format: orientation,
    monetizationEpisode,
    destination,
    units: units.map((unit, index): PlotLabPurposeUnit => ({
      id: `${orientation === "portrait" ? "ep" : "milestone"}-${expected[index]}`,
      number: expected[index],
      title: unit.title?.trim() || `${orientation === "portrait" ? "Episode" : "Milestone"} ${expected[index]}`,
      purposeLine: lines[index],
      incomingPressure: index === 0
        ? context?.unresolvedPressure?.trim() || "The unresolved opening pressure is still in motion."
        : lines[index - 1],
      decisiveMove: lines[index],
      stateDelta: lines[index],
      outgoingHook: lines[index + 1] || destination,
      dominantFunction: index === units.length - 1 ? "monetization_turn" : "story_progression",
      changedDimensions: [],
      scenePhase: "",
      characterFunctions: [],
      skeletonElementsUsed: index === units.length - 1 ? context?.requiredSkeletonElements ?? [] : [],
    })),
    warnings: duplicateWarning,
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
