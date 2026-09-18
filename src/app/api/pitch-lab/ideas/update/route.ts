import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAIModel, getConfiguredProviders } from "@/lib/ai/providers";
import { db } from "@/lib/db";
import { pitchIdeas, pitchWorkspaces } from "@/lib/db/schema";
import { isPitchLabSampleMode, PITCH_LAB_SAMPLE_TITLE_PREFIX } from "@/lib/ai/pitch-lab-samples";
import { parsePitchIdeaEnvelope, serializePitchIdeaEnvelope } from "@/lib/pitch-lab-idea-envelope";
import { getPitchLabModelCandidates, pitchLabErrorMessage } from "@/lib/pitch-lab-models";
import { getActivePitchLabFramework } from "@/lib/ai/pitch-lab-framework";
import { buildPitchLabRefinementPrompt, buildPitchLabRefinementSystemPrompt, cleanPitchLabTitle, isValidPitchLabTitle } from "@/lib/ai/pitch-lab-prompts";
import { requirePitchLabAdmin } from "@/lib/pitch-lab-access";
import { ensurePitchLabOwner } from "@/lib/pitch-lab-owner";

function parseRefinedIdea(raw: string, fallbackTitle: string): { title: string; ideaText: string } {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(clean);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.title === "string" && typeof record.ideaText === "string") {
        return { title: record.title.trim().slice(0, 160) || fallbackTitle, ideaText: record.ideaText.trim() };
      }
    }
  } catch {
    // Fall back to plain paragraph output from older model behavior.
  }
  return { title: fallbackTitle, ideaText: clean };
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
  const ideaText = typeof body?.ideaText === "string" ? body.ideaText.trim() : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!ideaId || !ideaText) return NextResponse.json({ error: "Idea text is required." }, { status: 400 });
  if (title && !isValidPitchLabTitle(title)) return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  const idea = await db.query.pitchIdeas.findFirst({ where: and(eq(pitchIdeas.id, ideaId), eq(pitchIdeas.workspaceId, workspace.id)) });
  if (!idea || idea.status !== "shortlisted") return NextResponse.json({ error: "Shortlist this idea before refining." }, { status: 404 });

  const envelope = parsePitchIdeaEnvelope(idea.ideaText);
  let updatedTitle = title || idea.title.replace(PITCH_LAB_SAMPLE_TITLE_PREFIX, "");
  let updatedText = ideaText;
  let isPlaceholder = idea.title.startsWith(PITCH_LAB_SAMPLE_TITLE_PREFIX);
  if (instruction) {
    if (isPitchLabSampleMode()) {
      // Keep local flow tests usable without sending a paid request to a model.
      updatedText = `${ideaText}\n\n[Sample refinement applied: ${instruction}]`;
      isPlaceholder = true;
    } else {
      const providers = await getConfiguredProviders();
      const candidates = getPitchLabModelCandidates(providers);
      if (!candidates.length) return NextResponse.json({ error: "No AI provider is configured. Ask an admin to add an API key." }, { status: 503 });
      let lastError: unknown = null;
      let refinedIdea: { title: string; ideaText: string } | null = null;
      const framework = await getActivePitchLabFramework();
      const priorTurns = envelope.turns.length
        ? envelope.turns.map((turn, index) => `Turn ${index + 1} instruction: ${turn.instruction || "Manual edit"}\nTurn ${index + 1} result: ${turn.ideaText}`).join("\n\n")
        : "None.";
      for (const candidate of candidates) {
        try {
          const result = await generateText({
            model: await getAIModel(candidate.modelId),
            system: buildPitchLabRefinementSystemPrompt(framework),
            prompt: buildPitchLabRefinementPrompt({ currentTitle: updatedTitle, currentText: ideaText, originalText: envelope.originalText, priorTurns, instruction }),
            maxOutputTokens: 1800,
            maxRetries: 0,
          });
          refinedIdea = parseRefinedIdea(result.text, updatedTitle);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          console.warn("[pitch-lab] idea refinement provider failed", {
            provider: candidate.provider,
            modelId: candidate.modelId,
            error: pitchLabErrorMessage(err),
          });
        }
      }
      if (!refinedIdea) {
        return NextResponse.json({ error: `All configured AI providers failed. Last error: ${pitchLabErrorMessage(lastError)}` }, { status: 502 });
      }
      updatedTitle = refinedIdea.title;
      updatedText = refinedIdea.ideaText;
      if (!updatedText) return NextResponse.json({ error: "The model returned an empty idea." }, { status: 502 });
      if (!isValidPitchLabTitle(updatedTitle)) return NextResponse.json({ error: "The model returned a title longer than two words. Try a simpler refinement." }, { status: 502 });
    }
  }

  const cleanTitle = cleanPitchLabTitle(updatedTitle.replace(/^\[Sample\]\s*/i, ""));
  if (!isValidPitchLabTitle(cleanTitle)) return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  const storedEnvelope = serializePitchIdeaEnvelope({
    originalText: envelope.originalText || updatedText,
    currentText: updatedText,
    turns: instruction
      ? [...envelope.turns, { instruction, ideaText: updatedText, createdAt: new Date().toISOString() }]
      : envelope.turns,
  });
  await db.update(pitchIdeas).set({
    title: cleanTitle,
    ideaText: storedEnvelope,
    updatedAt: new Date(),
  }).where(eq(pitchIdeas.id, ideaId));
  return NextResponse.json({ ideaText: storedEnvelope, currentText: updatedText, title: cleanTitle, isPlaceholder });
}
