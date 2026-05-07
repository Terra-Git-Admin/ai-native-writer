import { NextResponse } from "next/server";
import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, prompts } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { QUALITY_AGENT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

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

  const isOwner = doc.ownerId === session.user.id;
  const isAdmin = (session.user as { role?: string }).role === "admin";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { episodeTabId } = body as { episodeTabId?: string };
  if (!episodeTabId) {
    return NextResponse.json({ error: "episodeTabId is required" }, { status: 400 });
  }

  // Load all predefined_episodes tabs sorted by sequenceNumber then position
  const allTabs = await db.query.tabs.findMany({
    where: eq(tabs.documentId, id),
    orderBy: [asc(tabs.position)],
  });

  const episodeTabs = allTabs
    .filter((t) => t.type === "predefined_episodes")
    .sort((a, b) => {
      const aSeq = a.sequenceNumber ?? a.position;
      const bSeq = b.sequenceNumber ?? b.position;
      return aSeq - bSeq;
    });

  const currentIdx = episodeTabs.findIndex((t) => t.id === episodeTabId);
  if (currentIdx === -1) {
    return NextResponse.json({ error: "Episode tab not found" }, { status: 404 });
  }

  const currentTab = episodeTabs[currentIdx];
  const prevTab = currentIdx > 0 ? episodeTabs[currentIdx - 1] : null;

  // Load quality_agent prompt from DB, fall back to constant
  const promptRow = await db.query.prompts.findFirst({
    where: eq(prompts.id, "quality_agent"),
  });
  const systemPrompt = promptRow?.content || QUALITY_AGENT_SYSTEM_PROMPT;

  const userMessage = [
    prevTab
      ? `PREVIOUS EPISODE (for hook context):\n${prevTab.content || "(empty)"}`
      : "PREVIOUS EPISODE (for hook context):\nNo previous episode.",
    `\nEPISODE TO EVALUATE:\n${currentTab.content || "(empty)"}`,
  ].join("\n\n");

  try {
    const model = await getAIModel("gemini-2.5-pro", true);

    const result = streamText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 20000 } },
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
