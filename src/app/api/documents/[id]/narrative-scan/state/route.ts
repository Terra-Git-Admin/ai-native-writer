export const maxDuration = 300;

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, prompts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { NARRATIVE_SCAN_STATE_PROMPT } from "@/lib/ai/prompts";

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

// GET — returns episode labels for the range picker
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const episodeTabId = searchParams.get("episodeTabId");

  if (!episodeTabId) {
    return NextResponse.json({ error: "episodeTabId is required" }, { status: 400 });
  }

  const episodeTab = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, episodeTabId), eq(tabs.documentId, id)),
    columns: { content: true },
  });
  if (!episodeTab) {
    return NextResponse.json({ error: "Episode tab not found" }, { status: 404 });
  }

  const sections = extractEpisodeSections(episodeTab.content);
  const labels = sections.map((s) => s.split("\n")[0].trim());

  return NextResponse.json({ episodes: labels });
}

// POST — streams Pass 1 state map for the selected episode range
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
  const { episodeTabId, fromIndex, toIndex } = body as {
    episodeTabId?: string;
    fromIndex?: number;
    toIndex?: number;
  };

  if (!episodeTabId) {
    return NextResponse.json({ error: "episodeTabId is required" }, { status: 400 });
  }

  const episodeTab = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, episodeTabId), eq(tabs.documentId, id)),
  });
  if (!episodeTab) {
    return NextResponse.json({ error: "Episode tab not found" }, { status: 404 });
  }

  const allSections = extractEpisodeSections(episodeTab.content);
  if (allSections.length === 0) {
    return NextResponse.json(
      { error: "No episodes found in this tab" },
      { status: 400 }
    );
  }

  const start = fromIndex ?? 0;
  const end = toIndex ?? allSections.length - 1;
  const sections = allSections.slice(
    Math.max(0, start),
    Math.min(allSections.length - 1, end) + 1
  );

  const promptRow = await db.query.prompts.findFirst({
    where: eq(prompts.id, "narrative_scan_state"),
  });
  const systemPrompt = promptRow?.content ?? NARRATIVE_SCAN_STATE_PROMPT;

  const model = await getAIModel("gemini-3.1-pro-preview");

  const result = streamText({
    model,
    system: systemPrompt,
    prompt: `EPISODES (${sections.length} of ${allSections.length} total):\n\n${sections.join("\n\n---\n\n")}`,
  });

  return result.toTextStreamResponse();
}
