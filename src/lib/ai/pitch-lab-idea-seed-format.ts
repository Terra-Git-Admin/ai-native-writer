export function normalizePitchLabIdeaSeedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function validatePitchLabIdeaSeedText(text: string): string[] {
  const value = normalizePitchLabIdeaSeedText(text);
  const errors: string[] = [];
  if (!value) errors.push("Idea cannot be empty.");
  return errors;
}

export function assertPitchLabIdeaSeedText(text: string): string {
  const normalized = normalizePitchLabIdeaSeedText(text);
  const errors = validatePitchLabIdeaSeedText(normalized);
  if (errors.length) throw new Error(errors.join(" "));
  return normalized;
}
