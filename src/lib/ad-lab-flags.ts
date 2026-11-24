export function isAdLabEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.AD_LAB_ENABLED === "true";
}

export function isAdLabEnabledForClient(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_AD_LAB_ENABLED === "true";
}
