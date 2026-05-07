import { NextResponse } from "next/server";
import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, prompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { QUALITY_AGENT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

interface TiptapNode {
  type: string;
  attrs?: { level?: number };
  content?: TiptapNode[];
  text?: string;
}

function nodeText(node: TiptapNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

// Split a TipTap doc into episode sections keyed by episode index.
// An episode starts at any heading whose text matches /^episode\s*\d/i
// and runs until the next such heading (or end of doc).
function extractEpisodeSections(content: string | null): string[] {
  if (!content) return [];
  try {
    const doc = JSON.parse(content) as { content?: TiptapNode[] };
    const nodes = doc.content ?? [];

    const sections: string[] = [];
    let current: string[] = [];
    let inEpisode = false;

    for (const node of nodes) {
      const text = nodeText(node).trim();
      const isEpisodeHeading =
        node.type === "heading" && /^episode\s*\d/i.test(text);

      if (isEpisodeHeading) {
        if (inEpisode && current.length > 0) {
          sections.push(current.join("\n").trim());
        }
        current = [text];
        inEpisode = true;
      } else if (inEpisode) {
        if (text) current.push(text);
      }
    }

    if (inEpisode && current.length > 0) {
      sections.push(current.join("\n").trim());
    }

    return sections;
  } catch {
    return [];
  }
}

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
  const { episodeTabId, episodeIndex } = body as {
    episodeTabId?: string;
    episodeIndex?: number;
  };
  if (!episodeTabId) {
    return NextResponse.json(
      { error: "episodeTabId is required" },
      { status: 400 }
    );
  }

  const tab = await db.query.tabs.findFirst({
    where: eq(tabs.id, episodeTabId),
  });
  if (!tab) {
    return NextResponse.json({ error: "Tab not found" }, { status: 404 });
  }

  // Extract individual episode sections from the tab content
  const sections = extractEpisodeSections(tab.content);

  let currentEpisode: string;
  let prevEpisode: string | null;

  if (sections.length > 0 && episodeIndex !== undefined) {
    const idx = Math.max(0, Math.min(episodeIndex, sections.length - 1));
    currentEpisode = sections[idx] ?? tab.content ?? "(empty)";
    prevEpisode = idx > 0 ? sections[idx - 1] : null;
  } else {
    // Fallback: evaluate the whole tab
    currentEpisode = tab.content ?? "(empty)";
    prevEpisode = null;
  }

  // Load quality_agent prompt from DB, fall back to constant
  const promptRow = await db.query.prompts.findFirst({
    where: eq(prompts.id, "quality_agent"),
  });
  const systemPrompt = promptRow?.content || QUALITY_AGENT_SYSTEM_PROMPT;

  const userMessage = [
    prevEpisode
      ? `PREVIOUS EPISODE (for hook context):\n${prevEpisode}`
      : "PREVIOUS EPISODE (for hook context):\nNo previous episode.",
    `\nEPISODE TO EVALUATE:\n${currentEpisode}`,
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
