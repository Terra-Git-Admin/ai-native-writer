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
  const instructionShaped = units.find((unit) => {
    const line = unit.purposeLine.trim();
    return /\bleaving a concrete changed state that forces\b/i.test(line)
      || /\b(?:episode 1 consequence becomes a contract|the lead proves a defining quality|the central relationship changes|a hidden pressure becomes legible|the outside world collides with the leads|the lead crosses a threshold|the monetization turn lands)\b/i.test(line);
  });
  if (instructionShaped) {
    throw new Error(`Purpose Planner returned planning instructions instead of an Episode ${instructionShaped.number} story event.`);
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
