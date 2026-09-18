import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAIModel, getConfiguredProviders } from "@/lib/ai/providers";
import { db } from "@/lib/db";
import { pitchIdeas, pitchWorkspaces } from "@/lib/db/schema";
import { isPitchLabSampleMode, PITCH_LAB_SAMPLE_TITLE_PREFIX } from "@/lib/ai/pitch-lab-samples";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const ideaId = typeof body?.ideaId === "string" ? body.ideaId : "";
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 160) : "";
  const ideaText = typeof body?.ideaText === "string" ? body.ideaText.trim() : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!ideaId || !ideaText) return NextResponse.json({ error: "Idea text is required." }, { status: 400 });
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  const idea = await db.query.pitchIdeas.findFirst({ where: and(eq(pitchIdeas.id, ideaId), eq(pitchIdeas.workspaceId, workspace.id)) });
  if (!idea || idea.status !== "shortlisted") return NextResponse.json({ error: "Only shortlisted ideas can be updated." }, { status: 404 });

  let updatedText = ideaText;
  let isPlaceholder = idea.title.startsWith(PITCH_LAB_SAMPLE_TITLE_PREFIX);
  if (instruction) {
    if (isPitchLabSampleMode()) {
      // Keep local flow tests usable without sending a paid request to a model.
      updatedText = `${ideaText}\n\n[Sample refinement applied: ${instruction}]`;
      isPlaceholder = true;
    } else {
      const providers = await getConfiguredProviders();
      const modelId = providers.includes("openai") ? "gpt-5.2" : providers.includes("anthropic") ? "claude-sonnet-4-20250514" : providers.includes("google") ? "gemini-3.1-pro-preview" : null;
      if (!modelId) return NextResponse.json({ error: "No AI provider is configured. Ask an admin to add an API key." }, { status: 503 });
      try {
        const result = await generateText({
          model: await getAIModel(modelId),
          system: "Revise a pilot plot pitch in direct, compact plain language. Keep it as one flowing plot paragraph, in the style of the user's draft. Follow the requested changes while keeping a vivid opening pressure, a relationship or opposition engine, a consequential turn, and a next-episode pull. Return only the revised plot paragraph, with no labels or analysis.",
          prompt: `Current idea:\n${ideaText}\n\nRequested changes:\n${instruction}`,
          maxOutputTokens: 1800,
        });
        updatedText = result.text.trim();
        if (!updatedText) throw new Error("The model returned an empty idea.");
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "Idea update failed." }, { status: 502 });
      }
    }
  }

  const cleanTitle = (title || idea.title.replace(PITCH_LAB_SAMPLE_TITLE_PREFIX, "")).replace(/^\[Sample\]\s*/i, "");
  const storedTitle = `${isPlaceholder ? PITCH_LAB_SAMPLE_TITLE_PREFIX : ""}${cleanTitle}`;
  await db.update(pitchIdeas).set({
    title: storedTitle,
    ideaText: updatedText,
    updatedAt: new Date(),
  }).where(eq(pitchIdeas.id, ideaId));
  return NextResponse.json({ ideaText: updatedText, title: cleanTitle, isPlaceholder });
}
