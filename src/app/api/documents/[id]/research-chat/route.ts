import { NextResponse } from "next/server";
import { streamText } from "ai";
import { googleTools } from "@ai-sdk/google/internal";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, prompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { RESEARCH_AGENT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

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
    columns: { id: true, ownerId: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { messages } = body as {
    messages?: { role: "user" | "assistant"; content: string }[];
  };

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const promptRow = await db.query.prompts.findFirst({
    where: eq(prompts.id, "research_agent"),
  });
  const systemPrompt = promptRow?.content || RESEARCH_AGENT_SYSTEM_PROMPT;

  try {
    const model = await getAIModel("gemini-3.1-pro-preview");

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools: {
        google_search: googleTools.googleSearch({}),
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
