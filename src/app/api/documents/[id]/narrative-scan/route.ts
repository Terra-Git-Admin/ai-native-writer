export const maxDuration = 120;

import { NextResponse } from "next/server";
import { generateText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs, prompts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import {
  NARRATIVE_SCAN_STATE_PROMPT,
  NARRATIVE_SCAN_AUDIT_PROMPT,
} from "@/lib/ai/prompts";

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

function safeParseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  // Strip any markdown fences the model might add despite instructions
  const stripped = trimmed
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Try to extract a JSON array from somewhere in the text
    const match = stripped.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export interface ScanFlag {
  episode: string;
  character: string;
  moment: string;
  gap: string;
  severity: "critical" | "notable";
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
  const { episodeTabId } = body as { episodeTabId?: string };

  if (!episodeTabId) {
    return NextResponse.json({ error: "episodeTabId is required" }, { status: 400 });
  }

  const episodeTab = await db.query.tabs.findFirst({
    where: and(eq(tabs.id, episodeTabId), eq(tabs.documentId, id)),
  });
  if (!episodeTab) {
    return NextResponse.json({ error: "Episode tab not found" }, { status: 404 });
  }

  const sections = extractEpisodeSections(episodeTab.content);
  if (sections.length === 0) {
    return NextResponse.json(
      { error: "No episodes found in this tab" },
      { status: 400 }
    );
  }

  const allEpisodesText = sections.join("\n\n---\n\n");

  // Load prompts from DB (allows admin override), fallback to hardcoded
  const [statePromptRow, auditPromptRow] = await Promise.all([
    db.query.prompts.findFirst({ where: eq(prompts.id, "narrative_scan_state") }),
    db.query.prompts.findFirst({ where: eq(prompts.id, "narrative_scan_audit") }),
  ]);

  const stateSystemPrompt = statePromptRow?.content ?? NARRATIVE_SCAN_STATE_PROMPT;
  const auditSystemPrompt = auditPromptRow?.content ?? NARRATIVE_SCAN_AUDIT_PROMPT;

  try {
    const model = await getAIModel("gemini-3.1-pro-preview");

    // Pass 1: extract state chain
    const { text: stateText } = await generateText({
      model,
      system: stateSystemPrompt,
      prompt: `EPISODES:\n\n${allEpisodesText}`,
    });

    const stateChain = safeParseJson<unknown[]>(stateText);
    const stateChainStr = stateChain
      ? JSON.stringify(stateChain, null, 2)
      : stateText; // fallback: send raw if parse failed

    // Pass 2: audit for journey gaps
    const auditInput = [
      "STATE CHAIN:",
      stateChainStr,
      "",
      "FULL EPISODE TEXT:",
      allEpisodesText,
    ].join("\n");

    const { text: auditText } = await generateText({
      model,
      system: auditSystemPrompt,
      prompt: auditInput,
    });

    const flags = safeParseJson<ScanFlag[]>(auditText) ?? [];

    return NextResponse.json({ flags, episodeCount: sections.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
