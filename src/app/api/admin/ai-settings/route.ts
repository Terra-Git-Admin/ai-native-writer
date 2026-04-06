import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";

// GET /api/admin/ai-settings — returns which providers have keys configured
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const all = await db.select({ id: aiSettings.id }).from(aiSettings);
  const configured = all.map((r) => r.id);

  return NextResponse.json({
    anthropic: configured.includes("anthropic"),
    google: configured.includes("google"),
  });
}

// PUT /api/admin/ai-settings — save a key for a specific provider
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { provider, apiKey } = await req.json();

  if (!provider || !apiKey) {
    return NextResponse.json(
      { error: "provider and apiKey are required" },
      { status: 400 }
    );
  }

  if (!["anthropic", "google"].includes(provider)) {
    return NextResponse.json(
      { error: "provider must be anthropic or google" },
      { status: 400 }
    );
  }

  const encryptedKey = encrypt(apiKey);

  const existing = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.id, provider),
  });

  if (existing) {
    await db
      .update(aiSettings)
      .set({ apiKey: encryptedKey, updatedAt: new Date() })
      .where(eq(aiSettings.id, provider));
  } else {
    await db.insert(aiSettings).values({
      id: provider,
      apiKey: encryptedKey,
      updatedAt: new Date(),
    });
  }

  return NextResponse.json({ ok: true });
}
