export const RUBRIC_VERSION: string;
export const CATEGORIES: string[];
export function evaluatePair(pair: {
  documentId: string;
  episode: number;
  exportId: string | null;
  firstId: string;
  finalId: string;
  generationRunId: string | null;
  firstText: string;
  finalText: string;
}, labels?: Record<string, { material: boolean; category: string | null; reviewed?: boolean; rationale?: string }>): {
  pairId: string;
  episode: number;
  firstId: string;
  finalId: string;
  fitScore: number | null;
  scoreStatus: "pending" | "provisional" | "reviewed";
  wordEditRate: number | null;
  changedGroups: number;
  pendingGroups: number;
  firstWords: number;
  finalWords: number;
  deductionsPct: Record<string, number | null>;
  changes: Array<{ id: string; operation: string; firstText: string; finalText: string }>;
};
