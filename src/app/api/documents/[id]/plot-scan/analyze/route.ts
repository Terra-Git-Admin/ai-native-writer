export const maxDuration = 300;

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, prompts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { PLOT_SCAN_ANALYZE_PROMPT } from "@/lib/ai/prompts";

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

function extractPlotSections(content: string | null): string[] {
  if (!content) return [];
  try {
    const doc = JSON.parse(content) as { content?: TiptapNode[] };
    const nodes = doc.content ?? [];
    const sections: string[] = [];
    let current: string[] = [];
    let inSection = false;

    for (const node of nodes) {
      const text = nodeText(node).trim();
      const isH3 = node.type === "heading" && node.attrs?.level === 3;

      if (isH3 && text) {
        if (inSection && current.length > 0) {
          sections.push(current.join("\n").trim());
        }
        current = [text];
        inSection = true;
      } else if (inSection) {
        if (text) current.push(text);
      }
    }

    if (inSection && current.length > 0) {
      sections.push(current.join("\n").trim());
    }

    return sections;
  } catch {
    return [];
  }
}

export async function POST(
  _req: Request,
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

  const plotTab = await db.query.tabs.findFirst({
    where: and(eq(tabs.documentId, id), eq(tabs.type, "microdrama_plots")),
  });
  if (!plotTab) {
    return NextResponse.json(
      { error: "Microdrama Plots tab not found" },
      { status: 404 }
    );
  }

  const sections = extractPlotSections(plotTab.content);
  if (sections.length === 0) {
    return NextResponse.json(
      { error: "No plots found in the Microdrama Plots tab" },
      { status: 400 }
    );
  }

  const promptRow = await db.query.prompts.findFirst({
    where: eq(prompts.id, "plot_scan_analyze"),
  });
  const systemPrompt = promptRow?.content ?? PLOT_SCAN_ANALYZE_PROMPT;

  const model = await getAIModel("gemini-3.1-pro-preview");

  const result = streamText({
    model,
    system: systemPrompt,
    prompt: `MICRODRAMA PLOTS (${sections.length} episodes):\n\n${sections.join("\n\n---\n\n")}`,
  });

  return result.toTextStreamResponse();
}
