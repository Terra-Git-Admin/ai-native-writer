export function normalizeSkeletonElement(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function countSentences(value: string): number {
  const normalized = value.trim();
  if (!normalized) return 0;
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return Array.from(segmenter.segment(normalized)).filter((segment) => segment.segment.trim()).length;
}

export function countWords(value: string): number {
  return value.trim().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function hasBecauseThenStructure(value: string): boolean {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const sentences = Array.from(segmenter.segment(value.trim()))
    .map((segment) => segment.segment.trim())
    .filter(Boolean);
  return (
    sentences.length === 2 &&
    /^because\b/i.test(sentences[0]) &&
    /^then\b/i.test(sentences[1])
  );
}

export function hasWeakCliffhanger(value: string): boolean {
  const thenSentence = value.trim().split(/\bThen\b/i).at(-1)?.trim() ?? "";
  return (
    /\?\s*$/.test(thenSentence) ||
    /\bmust (?:decide|choose|find|figure out|work out|learn)\b/i.test(thenSentence) ||
    /\b(?:needs?|has) to (?:decide|choose|find|figure out|work out|learn)\b/i.test(thenSentence) ||
    /\b(?:wonders?|questions?|considers?) (?:if|whether|how|what)\b/i.test(thenSentence)
  );
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
