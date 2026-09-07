import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, handoffExports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
      return parts[parts.length - 1];
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

function isRateLimited(key: string): boolean {
  const now = Date.now();
  cleanupRateLimitMap(now);
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

// GET /api/export/[exportId]
// Auth required. Returns the stored WriterExport JSON to the export creator,
// document owner, or an admin.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ exportId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { exportId } = await params;
  const ip = getClientIp(req);

  if (isRateLimited(`ip:${ip}`) || isRateLimited(`export:${exportId}`)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
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

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, row.documentId),
    columns: { ownerId: true },
  });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const canReadExport =
    row.createdBy === session.user.id ||
    doc.ownerId === session.user.id ||
    session.user.role === "admin";

  if (!canReadExport) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(JSON.parse(row.exportJson), {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
