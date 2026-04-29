// Infers a tab's type (and sequenceNumber, for reference episodes) from its
// title. Used on tab create + rename so writers never have to pick a category.
// Unknown names fall through to 'custom'.

export type InferredTabType =
  | "custom"
  | "series_overview"
  | "characters"
  | "series_skeleton"
  | "microdrama_plots"
  | "predefined_episodes"
  | "workbook"
  | "research";

export interface InferredTab {
  type: InferredTabType;
  sequenceNumber: number | null;
}

export function inferTabType(rawTitle: string): InferredTab {
  const t = (rawTitle || "").trim().toLowerCase();

  if (/^predefined\s*episodes?\b/.test(t) || /^reference\s*episodes?\b/.test(t)) {
    return { type: "predefined_episodes", sequenceNumber: null };
  }
  if (/^original\s*research\b/.test(t) || /^series\s*overview\b/.test(t) || /^overview\b/.test(t)) {
    return { type: "series_overview", sequenceNumber: null };
  }
  if (/^characters?\b/.test(t) || /^cast\b/.test(t)) {
    return { type: "characters", sequenceNumber: null };
  }
  if (
    /^series\s*skeleton\b/.test(t) ||
    /^skeleton\b/.test(t) ||
    /^series\s*spine\b/.test(t)
  ) {
    return { type: "series_skeleton", sequenceNumber: null };
  }
  if (/^microdrama\s*plots?\b/.test(t) || /^episode\s*plots?\b/.test(t) || /^plots?\b/.test(t)) {
    return { type: "microdrama_plots", sequenceNumber: null };
  }
  if (/^workbook\b/.test(t)) {
    return { type: "workbook", sequenceNumber: null };
  }
  if (/^research\b/.test(t) || /^original\s*(story|plotline)\b/.test(t) || /^source\b/.test(t)) {
    return { type: "research", sequenceNumber: null };
  }

  return { type: "custom", sequenceNumber: null };
}
