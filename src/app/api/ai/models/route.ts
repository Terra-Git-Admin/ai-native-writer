import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AI_MODELS, getConfiguredProviders } from "@/lib/ai/providers";

// GET /api/ai/models — returns available models based on configured keys
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providers = await getConfiguredProviders();

  const available = AI_MODELS.filter((m) => providers.includes(m.provider));

  return NextResponse.json(available);
}
