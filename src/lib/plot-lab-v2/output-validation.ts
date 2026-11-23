export function normalizeSkeletonElement(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function countSentences(value: string): number {
  const normalized = value.trim();
  if (!normalized) return 0;
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return Array.from(segmenter.segment(normalized)).filter((segment) => segment.segment.trim()).length;
}

export function findMissingSkeletonElement(input: {
  required: string[];
  unitElements: string[];
  coverage: Array<{ element: string; unitNumbers: number[] }>;
  allowedUnitNumbers: number[];
}): string | undefined {
  const usedByUnits = new Set(input.unitElements.map(normalizeSkeletonElement));
  const indexedCoverage = new Map(
    input.coverage.map((entry) => [normalizeSkeletonElement(entry.element), entry.unitNumbers])
  );
  return input.required.find((element) => {
    const key = normalizeSkeletonElement(element);
    const unitNumbers = indexedCoverage.get(key) ?? [];
    return (
      !usedByUnits.has(key) ||
      unitNumbers.length === 0 ||
      unitNumbers.some((number) => !input.allowedUnitNumbers.includes(number))
    );
  });
}
