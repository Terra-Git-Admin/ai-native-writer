export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
};

export type TiptapDocument = TiptapNode & { type: "doc" };

const SECTION_PATTERN = /^\[P\]\s+([ABCD])\s+—\s+(NEW CLIP|EXISTING FOOTAGE)\s*$/gm;
const EXPECTED = [
  ["A", "NEW CLIP"],
  ["B", "EXISTING FOOTAGE"],
  ["C", "NEW CLIP"],
  ["D", "EXISTING FOOTAGE"],
] as const;

export function validateAdDraft(tagged: string): { ok: boolean; error?: string } {
  const sections = [...tagged.matchAll(SECTION_PATTERN)];
  if (!/^\[H3\]\s+Ad:\s+\S+/m.test(tagged)) return { ok: false, error: "Add an [H3] Ad name before saving." };
  if (sections.length !== 4) return { ok: false, error: "The ad must contain exactly A, B, C, and D." };
  for (let index = 0; index < EXPECTED.length; index += 1) {
    const [, letter, kind] = sections[index];
    const [expectedLetter, expectedKind] = EXPECTED[index];
    if (letter !== expectedLetter || kind !== expectedKind) return { ok: false, error: `Section ${expectedLetter} must be ${expectedKind}.` };
    const start = sections[index].index ?? 0;
    const end = sections[index + 1]?.index ?? tagged.length;
    const body = tagged.slice(start, end);
    if (!/^\[UL\]\s+\(Visual:\s*\S+/m.test(body)) return { ok: false, error: `Section ${letter} needs a Visual line.` };
    if ((letter === "B" || letter === "D") && !/^\[UL\]\s+\(Source Footage:\s*\S+/m.test(body)) return { ok: false, error: `Section ${letter} needs writer-supplied Source Footage.` };
  }
  return { ok: true };
}

function clean(value: string): string {
  return value.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
}

export function buildLocalAdDraft(name: string, brief: string): string {
  const title = clean(name) || "Untitled Ad";
  const source = clean(brief) || "Writer-supplied story moment to be selected";
  return [
    `[H3] Ad: ${title}`,
    "[P] A — NEW CLIP",
    `[UL] (Visual: Open on newly produced material that frames the hook: ${source}.)`,
    "[UL] (On-screen Text: What would you do?)",
    "[UL] (Writer Notes: Establish the advertising idea quickly.)",
    "[P] B — EXISTING FOOTAGE",
    `[UL] (Source Footage: ${source})`,
    "[UL] (Visual: Use the writer-supplied footage as direct story evidence.)",
    "[UL] (Writer Notes: Preserve the original performance and continuity.)",
    "[P] C — NEW CLIP",
    "[UL] (Visual: Return to newly produced material that escalates or reframes the hook.)",
    "[UL] (V.O.: But that was only the beginning.)",
    "[UL] (Writer Notes: Connect cleanly back into the series footage.)",
    "[P] D — EXISTING FOOTAGE",
    `[UL] (Source Footage: ${source})`,
    "[UL] (Visual: End on the strongest writer-supplied payoff, reveal, or unresolved question.)",
    "[UL] (On-screen Text: Watch now.)",
  ].join("\n");
}

export function appendTiptapDocument(existing: string | null, addition: string): string {
  const current = existing ? (JSON.parse(existing) as TiptapDocument) : { type: "doc" as const, content: [] };
  const next = JSON.parse(addition) as TiptapDocument;
  return JSON.stringify({ type: "doc", content: [...(current.content ?? []), ...(next.content ?? [])] });
}
