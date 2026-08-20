import { NextResponse } from "next/server";
import { generateText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import { ENTITY_EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";

interface TiptapNode {
  type?: string;
  attrs?: { level?: number; textAlign?: string | null };
  content?: TiptapNode[];
  text?: string;
}

function extractExistingNames(content: string | null): Set<string> {
  const names = new Set<string>();
  if (!content) return names;
  try {
    const doc = JSON.parse(content) as { content?: TiptapNode[] };
    for (const node of doc.content ?? []) {
      if (node.type === "heading" && node.attrs?.level === 2) {
        const text = (node.content ?? [])
          .map((n) => n.text ?? "")
          .join("")
          .trim()
          .toLowerCase();
        if (text) names.add(text);
      }
    }
  } catch {
    // ignore
  }
  return names;
}

function parseExtractionOutput(
  output: string
): Array<{ name: string; description: string }> {
  const entries: Array<{ name: string; description: string }> = [];
  let current: { name: string; description: string } | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    // Accept both [H2] tagged format and <h2> / ## markdown/HTML formats
    const h2 =
      line.match(/^\[H2\]\s*(.+)$/) ||
      line.match(/^<h2>(.+?)<\/h2>$/i) ||
      line.match(/^##\s+(.+)$/);
    const p = line.match(/^\[P\]\s*(.+)$/) || line.match(/^<p>(.+?)<\/p>$/i);
    if (h2) {
      if (current) entries.push(current);
      current = { name: h2[1].trim(), description: "" };
    } else if (current && !current.description) {
      if (p) {
        current.description = p[1].trim();
      } else if (line && !line.startsWith("<") && !line.startsWith("[") && !line.startsWith("#")) {
        current.description = line;
      }
    }
  }
  if (current) entries.push(current);
  return entries;
}

function buildEntryNodes(
  entry: { name: string; description: string }
): TiptapNode[] {
  const nodes: TiptapNode[] = [
    {
      type: "heading",
      attrs: { level: 2, textAlign: null },
      content: [{ type: "text", text: entry.name }],
    },
  ];
  if (entry.description) {
    nodes.push({
      type: "paragraph",
      content: [{ type: "text", text: entry.description }],
    });
  } else {
    nodes.push({ type: "paragraph" });
  }
  return nodes;
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
    columns: { ownerId: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const type: string = body.type;

  if (type !== "characters" && type !== "locations") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const allTabs = await db.query.tabs.findMany({
    where: eq(tabs.documentId, id),
    columns: { id: true, type: true, content: true },
  });

  const sourceTabs = allTabs.filter((t) => t.type === "predefined_episodes");
  const targetTab = allTabs.find((t) => t.type === type);

  if (!targetTab) {
    return NextResponse.json({ error: "Target tab not found" }, { status: 404 });
  }

  if (sourceTabs.length === 0) {
    return NextResponse.json({ added: [], empty: true });
  }

  const episodesTagged = sourceTabs
    .map((t) => tiptapJsonToTagged(t.content ?? null))
    .filter(Boolean)
    .join("\n\n");

  if (!episodesTagged.trim()) {
    return NextResponse.json({ added: [], empty: true });
  }

  const entityLabel = type === "characters" ? "characters and their descriptions" : "locations and their descriptions";
  const model = await getAIModel("gemini-2.5-flash");
  const { text } = await generateText({
    model,
    system: ENTITY_EXTRACTION_SYSTEM_PROMPT,
    prompt: `Extract ${entityLabel} from the following episode content:\n\n${episodesTagged}`,
  });

  if (!text.trim() || text.trim() === "NONE") {
    return NextResponse.json({ added: [] });
  }

  const existing = extractExistingNames(targetTab.content);
  const extracted = parseExtractionOutput(text);

  const newEntries = extracted.filter(
    (e) => e.name && !existing.has(e.name.toLowerCase().trim())
  );

  if (newEntries.length === 0) {
    return NextResponse.json({ added: [] });
  }

  let existingDoc: { type: string; content: TiptapNode[] };
  try {
    existingDoc = JSON.parse(targetTab.content ?? '{"type":"doc","content":[]}');
  } catch {
    existingDoc = { type: "doc", content: [] };
  }

  const newNodes = newEntries.flatMap(buildEntryNodes);
  existingDoc.content = [...(existingDoc.content ?? []), ...newNodes];
  const newContent = JSON.stringify(existingDoc);

  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db
    .update(tabs)
    .set({ content: newContent, updatedAt: now })
    .where(and(eq(tabs.id, targetTab.id), eq(tabs.documentId, id)));

  await db
    .update(documents)
    .set({ updatedAt: now })
    .where(eq(documents.id, id));

  return NextResponse.json({ added: newEntries.map((e) => e.name) });
}
