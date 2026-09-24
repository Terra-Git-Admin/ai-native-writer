import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCanonicalTabRows, CURRENT_CANONICAL_TABS_VERSION } from "@/lib/canonical-tabs";
import { documents, pitchIdeas, pitchWorkspaces, tabs } from "@/lib/db/schema";
import { parsePitchIdeaEnvelope } from "@/lib/pitch-lab-idea-envelope";
import { requirePitchLabAccess } from "@/lib/pitch-lab-access";
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

function logPitchLabFinalizedOutput(input: {
  workspaceId: string;
  ideaId: string;
  documentId: string;
  title: string;
  originalText: string;
  finalText: string;
  refinementCount: number;
}) {
  console.info("[pitch-lab] finalize.output", {
    workspaceId: input.workspaceId,
    ideaId: input.ideaId,
    documentId: input.documentId,
    title: input.title,
    refinementCount: input.refinementCount,
    originalWordCount: input.originalText.split(/\s+/).filter(Boolean).length,
    finalWordCount: input.finalText.split(/\s+/).filter(Boolean).length,
    originalText: input.originalText,
    finalText: input.finalText,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  const accessError = requirePitchLabAccess(session);
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
    const promoted = db.transaction((tx) => {
      const idea = tx.select().from(pitchIdeas).where(eq(pitchIdeas.id, ideaId)).get();
      if (!idea || idea.workspaceId !== workspace.id) throw new Error("Idea not found.");
      const envelope = parsePitchIdeaEnvelope(idea.ideaText);
      if (idea.status === "promoted" && idea.promotedDocumentId) {
        return {
          documentId: idea.promotedDocumentId,
          ideaId: idea.id,
          title: idea.title,
          originalText: envelope.originalText.trim(),
          finalText: envelope.currentText.trim(),
          refinementCount: envelope.turns.length,
          alreadyPromoted: true,
        };
      }
      if (idea.status !== "shortlisted") throw new Error("Shortlist this idea before finalizing it.");
      const currentText = envelope.currentText.trim();
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
      return {
        documentId: id,
        ideaId: idea.id,
        title,
        originalText: envelope.originalText.trim(),
        finalText: currentText,
        refinementCount: envelope.turns.length,
        alreadyPromoted: false,
      };
    });
    if (!promoted.alreadyPromoted) {
      logPitchLabFinalizedOutput({
        workspaceId: workspace.id,
        ideaId: promoted.ideaId,
        documentId: promoted.documentId,
        title: promoted.title,
        originalText: promoted.originalText,
        finalText: promoted.finalText,
        refinementCount: promoted.refinementCount,
      });
    }
    return NextResponse.json({ id: promoted.documentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not promote this idea.";
    const status = message === "Idea not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
