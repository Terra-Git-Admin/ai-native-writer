import { NextResponse } from "next/server";
import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, prompts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { OUTSIDERS_PERSPECTIVE_SYSTEM_PROMPT } from "@/lib/ai/prompts";

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

// Split a TipTap doc into episode sections by Episode heading
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
    columns: { id: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { messages, episodeTabId, episodeIndex } = body as {
    messages?: { role: "user" | "assistant"; content: string }[];
    episodeTabId?: string;
    episodeIndex?: number;
  };

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }
  if (!episodeTabId || episodeIndex === undefined) {
    return NextResponse.json(
      { error: "episodeTabId and episodeIndex are required" },
      { status: 400 }
    );
  }

  // Load predefined_episodes tab + microdrama_plots tab in parallel
  const [episodeTab, plotsTab] = await Promise.all([
    db.query.tabs.findFirst({ where: eq(tabs.id, episodeTabId) }),
    db.query.tabs.findFirst({
      where: and(eq(tabs.documentId, id), eq(tabs.type, "microdrama_plots")),
    }),
  ]);

  if (!episodeTab) {
    return NextResponse.json({ error: "Episode tab not found" }, { status: 404 });
  }

  // Extract episode sections from predefined_episodes tab
  const episodeSections = extractEpisodeSections(episodeTab.content);
  const idx = Math.max(0, Math.min(episodeIndex, episodeSections.length - 1));
  const currentEpisode = episodeSections[idx] ?? "(empty)";
  const prevStart = Math.max(0, idx - 3);
  const prevEpisodes = episodeSections.slice(prevStart, idx);

  // Extract matching plot from microdrama_plots tab (same index)
  const plotSections = extractEpisodeSections(plotsTab?.content ?? null);
  const currentPlot = plotSections[idx] ?? null;

  const promptRow = await db.query.prompts.findFirst({
    where: eq(prompts.id, "outsiders_perspective"),
  });
  const basePrompt = promptRow?.content || OUTSIDERS_PERSPECTIVE_SYSTEM_PROMPT;

  // Build context block — only what a viewer would know + writer's intent for this ep
  const contextParts: string[] = [];

  if (prevEpisodes.length > 0) {
    contextParts.push("AUDIENCE CONTEXT — PREVIOUS EPISODES (what the viewer has seen):");
    prevEpisodes.forEach((ep, i) => {
      contextParts.push(`--- Previous Episode -${prevEpisodes.length - i} ---`);
      contextParts.push(ep);
    });
  } else {
    contextParts.push("AUDIENCE CONTEXT: This is the first episode — no prior viewing history.");
  }

  if (currentPlot) {
    contextParts.push("");
    contextParts.push("WRITER'S INTENT — PLOT OUTLINE FOR THIS EPISODE:");
    contextParts.push(currentPlot);
  }

  contextParts.push("");
  contextParts.push("EPISODE TO ANALYZE:");
  contextParts.push(currentEpisode);

  const systemPrompt = [basePrompt, "", "---", "", ...contextParts].join("\n");

  try {
    const model = await getAIModel("gemini-3.1-pro-preview");

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
