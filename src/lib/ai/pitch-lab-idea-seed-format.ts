export function normalizePitchLabIdeaSeedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function validatePitchLabIdeaSeedText(text: string): string[] {
  const value = normalizePitchLabIdeaSeedText(text);
  const errors: string[] = [];
  if (!/^FL\b/.test(value)) errors.push("Idea must start with FL.");
  if (!/\bML\b/.test(value)) errors.push("Idea must include ML.");
  if (/[.!?].+[.!?]/.test(value)) errors.push("Idea must be one sentence or fragment.");
  return errors;
}

export function assertPitchLabIdeaSeedText(text: string): string {
  const normalized = normalizePitchLabIdeaSeedText(text);
  const errors = validatePitchLabIdeaSeedText(normalized);
  if (errors.length) throw new Error(errors.join(" "));
  return normalized;
}
