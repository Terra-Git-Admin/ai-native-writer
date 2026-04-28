// Next.js instrumentation hook. Runs once per Node process boot.
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// Boot recovery: any ai_jobs row left as pending|running from a previous
// process is healed to status='failed', failure_reason='instance_restart'.
// Without this, frontend SSE subscribers would hang forever waiting for
// events from a dead generator.

export async function register(): Promise<void> {
  // Only register in the Node runtime — instrumentation also fires under
  // edge runtime where better-sqlite3 + db imports are not available.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Lazy import to avoid pulling DB code into edge bundles. Top-level imports
  // would crash the edge runtime where better-sqlite3 is unavailable.
  const { recoverOrphanJobs } = await import("@/lib/ai/jobs");
  const { logEvent } = await import("@/lib/saveTrace");

  try {
    const recovered = await recoverOrphanJobs();
    logEvent("instrumentation.boot.ok", {
      orphanJobsRecovered: recovered,
    });
  } catch (err) {
    logEvent("instrumentation.boot.fail", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
