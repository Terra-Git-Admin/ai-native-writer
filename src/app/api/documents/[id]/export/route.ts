// Admin export — produces a human-readable Markdown document for a series:
// Characters, Locations, and Predefined Episodes (optionally sliced to an
// episode range), plus a link back to the series doc. Admin-gated.
// Reuses the same Tiptap→tagged + H3-slice helpers the AI pipeline uses so
// the export matches what the model sees.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, tabs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  tiptapJsonToTagged,
  splitTabByH3,
  extractEpisodeNumber,
} from "@/lib/ai/context-engine";

// Convert the engine's tagged line format ([H1]/[H2]/[P]/[UL]/[OL]) to
// Markdown. Tab-title [H1] lines are dropped — we emit our own section
// headers. Character (H2) and episode (H3) headings both render as `###`
// so they sit cleanly under our `##` section headers.
function taggedToMarkdown(tagged: string): string {
  if (!tagged) return "";
  const out: string[] = [];
  for (const line of tagged.split("\n")) {
    const m = line.match(/^\[(H[1-6]|P|UL|OL)\]\s?(.*)$/);
    if (!m) continue;
    const tag = m[1];
    const text = m[2];
    if (tag === "H1") continue;
    if (tag === "H2" || tag === "H3") out.push(`### ${text}`);
    else if (tag === "H4") out.push(`#### ${text}`);
    else if (tag === "H5" || tag === "H6") out.push(`##### ${text}`);
    else if (tag === "UL") out.push(`- ${text}`);
    else if (tag === "OL") out.push(`1. ${text}`);
    else out.push(text); // [P]
  }
  return out.join("\n\n");
}

function parseEpisodeParam(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: documentId } = await params;

  const docRow = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!docRow) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const from = parseEpisodeParam(url.searchParams.get("from"));
  const to = parseEpisodeParam(url.searchParams.get("to"));

  const tabRows = await db.query.tabs.findMany({
    where: eq(tabs.documentId, documentId),
  });
  const charTab = tabRows.find((t) => t.type === "characters");
  const locTab = tabRows.find((t) => t.type === "locations");
  const epTab = tabRows.find((t) => t.type === "predefined_episodes");

  const origin = url.origin;
  const docLink = `${origin}/doc/${documentId}`;
  const scopeLabel =
    from == null && to == null
      ? "All episodes"
      : `Episodes ${from ?? "start"}–${to ?? "end"}`;

  const parts: string[] = [];
  parts.push(`# ${docRow.title}`);
  parts.push(
    `**Series doc:** ${docLink}  \n**Exported:** ${new Date().toISOString()}  \n**Scope:** ${scopeLabel}`
  );
  parts.push("---");

  // Characters (always full)
  parts.push("## Characters");
  const charMd = taggedToMarkdown(tiptapJsonToTagged(charTab?.content ?? null));
  parts.push(charMd || "_No characters recorded._");

  // Locations (always full)
  parts.push("## Locations");
  const locMd = taggedToMarkdown(tiptapJsonToTagged(locTab?.content ?? null));
  parts.push(locMd || "_No locations recorded._");

  // Episodes (sliced to range if given)
  parts.push("## Episodes");
  let sections = splitTabByH3(tiptapJsonToTagged(epTab?.content ?? null));
  if (from != null || to != null) {
    sections = sections.filter((s) => {
      const n = extractEpisodeNumber(s.title);
      if (n == null) return false;
      if (from != null && n < from) return false;
      if (to != null && n > to) return false;
      return true;
    });
  }
  parts.push(
    sections.length === 0
      ? "_No episodes in range._"
      : sections.map((s) => taggedToMarkdown(s.content)).join("\n\n")
  );

  const markdown = parts.join("\n\n");

  const safeTitle =
    docRow.title
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "series";
  const rangeSuffix =
    from != null || to != null ? `_ep${from ?? "start"}-${to ?? "end"}` : "";
  const filename = `${safeTitle}${rangeSuffix}.md`;

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
