export function isPitchLabEnabled(): boolean {
  return process.env.PITCH_LAB_ENABLED === "true";
}

export function isPitchLabEnabledForClient(): boolean {
  return process.env.NEXT_PUBLIC_PITCH_LAB_ENABLED === "true";
}
