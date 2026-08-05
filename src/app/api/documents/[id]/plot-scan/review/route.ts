export const maxDuration = 300;

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, prompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { PLOT_SCAN_REVIEW_PROMPT } from "@/lib/ai/prompts";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    columns: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { structureMap } = body as { structureMap?: string };

  if (!structureMap || structureMap.trim().length === 0) {
    return NextResponse.json(
      { error: "structureMap is required" },
      { status: 400 }
    );
  }

  const promptRow = await db.query.prompts.findFirst({
    where: eq(prompts.id, "plot_scan_review"),
  });
  const systemPrompt = promptRow?.content ?? PLOT_SCAN_REVIEW_PROMPT;

  const model = await getAIModel("gemini-3.1-pro-preview");

  const result = streamText({
    model,
    system: systemPrompt,
    prompt: `STRUCTURAL MAP:\n\n${structureMap}`,
  });

  return result.toTextStreamResponse();
}
