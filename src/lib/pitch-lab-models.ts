export type PitchLabModelCandidate = {
  provider: "openai" | "anthropic" | "google";
  modelId: string;
};

export function getPitchLabModelCandidates(providers: string[]): PitchLabModelCandidate[] {
  return [
    ...(providers.includes("openai") ? [{ provider: "openai" as const, modelId: "gpt-5.2" }] : []),
    ...(providers.includes("anthropic") ? [{ provider: "anthropic" as const, modelId: "claude-sonnet-4-20250514" }] : []),
    ...(providers.includes("google") ? [{ provider: "google" as const, modelId: "gemini-3.1-pro-preview" }] : []),
  ];
}

export function pitchLabErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AI request failed.";
}
