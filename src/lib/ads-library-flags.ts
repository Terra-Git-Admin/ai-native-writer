export function isAdsLibraryEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ADS_LIBRARY_ENABLED === "true";
}

export function isAdsLibraryEnabledForClient(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ADS_LIBRARY_ENABLED === "true";
}
