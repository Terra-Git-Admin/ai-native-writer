import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handoffExports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logEvent } from "@/lib/saveTrace";

// Simple in-memory rate limiter: 60 req/min per client and per export token.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_MAX_KEYS = 5_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[0];
    }
  }
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

function cleanupRateLimitMap(now: number): void {
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
  while (rateLimitMap.size > RATE_LIMIT_MAX_KEYS) {
    const oldestKey = rateLimitMap.keys().next().value;
    if (!oldestKey) break;
    rateLimitMap.delete(oldestKey);
  }
}

function checkRateLimit(key: string): { limited: boolean; resetAt: number } {
  const now = Date.now();
  cleanupRateLimitMap(now);
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(key, { count: 1, resetAt });
    return { limited: false, resetAt };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { limited: true, resetAt: entry.resetAt };
  }
  entry.count++;
  return { limited: false, resetAt: entry.resetAt };
}

// GET /api/export/[exportId]
// Public: no auth required. Returns the stored WriterExport JSON.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ exportId: string }> }
) {
  const { exportId } = await params;
  const ip = getClientIp(req);

  const ipLimit = checkRateLimit(`ip:${ip}`);
  if (ipLimit.limited) {
    const retryAfter = Math.max(
      1,
      Math.ceil((ipLimit.resetAt - Date.now()) / 1000)
    );
    logEvent("export.rate_limited", {
      keyType: "ip",
      retryAfter,
    });
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const exportLimit = checkRateLimit(`export:${exportId}`);
  if (exportLimit.limited) {
    const retryAfter = Math.max(
      1,
      Math.ceil((exportLimit.resetAt - Date.now()) / 1000)
    );
    logEvent("export.rate_limited", {
      keyType: "export",
      retryAfter,
    });
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const row = await db.query.handoffExports.findFirst({
    where: eq(handoffExports.id, exportId),
  });

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.expiresAt < new Date()) {
    return NextResponse.json({ error: "Export expired" }, { status: 410 });
  }

  return NextResponse.json(JSON.parse(row.exportJson), {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
