import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCanonicalTabRows, CURRENT_CANONICAL_TABS_VERSION } from "@/lib/canonical-tabs";
import { documents, pitchIdeas, pitchWorkspaces, tabs } from "@/lib/db/schema";
import { parsePitchIdeaEnvelope } from "@/lib/pitch-lab-idea-envelope";
import { requirePitchLabAdmin } from "@/lib/pitch-lab-access";
import { ensurePitchLabOwner } from "@/lib/pitch-lab-owner";
import { cleanPitchLabTitle, isValidPitchLabTitle } from "@/lib/ai/pitch-lab-prompts";

function paragraphDoc(title: string, ideaText: string) {
  return JSON.stringify({
    type: "doc",
    content: [
      { type: "heading", attrs: { textAlign: null, level: 1 }, content: [{ type: "text", text: "Microdrama Plots" }] },
      { type: "heading", attrs: { textAlign: null, level: 2 }, content: [{ type: "text", text: `Episode 1: ${title}` }] },
      ...ideaText.split(/\n+/).filter(Boolean).map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    ],
  });
}

export async function POST(req: Request) {
  const session = await auth();
  const accessError = requirePitchLabAdmin(session);
  if (accessError) return accessError;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensurePitchLabOwner(session);
  const body = await req.json().catch(() => null);
  const ideaId = typeof body?.ideaId === "string" ? body.ideaId : "";
  const title = typeof body?.title === "string" ? cleanPitchLabTitle(body.title) : "";
  if (!ideaId || !title) return NextResponse.json({ error: "Idea title is required." }, { status: 400 });
  if (!isValidPitchLabTitle(title)) return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ error: "Idea not found." }, { status: 404 });

  try {
    const documentId = db.transaction((tx) => {
      const idea = tx.select().from(pitchIdeas).where(eq(pitchIdeas.id, ideaId)).get();
      if (!idea || idea.workspaceId !== workspace.id) throw new Error("Idea not found.");
      if (idea.status === "promoted" && idea.promotedDocumentId) return idea.promotedDocumentId;
      if (idea.status !== "shortlisted") throw new Error("Shortlist this idea before finalizing it.");
      const currentText = parsePitchIdeaEnvelope(idea.ideaText).currentText.trim();
      if (!currentText) throw new Error("Idea plot is required.");

      const id = nanoid(12);
      const now = new Date();
      const { rows, firstTabId } = buildCanonicalTabRows(id, now);
      const plotTab = rows.find((row) => row.type === "microdrama_plots");
      if (!plotTab) throw new Error("The canonical Microdrama Plots tab was not created.");
      plotTab.content = paragraphDoc(title, currentText);
      tx.insert(documents).values({
        id, title, content: null, ownerId: session.user.id, activeTabId: firstTabId,
        createdAt: now, updatedAt: now, canonicalTabsVersion: CURRENT_CANONICAL_TABS_VERSION,
      }).run();
      tx.insert(tabs).values(rows).run();
      tx.update(pitchIdeas).set({
        title, status: "promoted", promotedDocumentId: id, updatedAt: now,
      }).where(eq(pitchIdeas.id, ideaId)).run();
      return id;
    });
    return NextResponse.json({ id: documentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not promote this idea.";
    const status = message === "Idea not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
