import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAIModel, getConfiguredProviders } from "@/lib/ai/providers";
import { db } from "@/lib/db";
import { pitchIdeas, pitchWorkspaces } from "@/lib/db/schema";
import { isPitchLabSampleMode, PITCH_LAB_SAMPLE_TITLE_PREFIX } from "@/lib/ai/pitch-lab-samples";
import { cleanPitchIdeaText, parsePitchIdeaEnvelope, serializePitchIdeaEnvelope } from "@/lib/pitch-lab-idea-envelope";
import { getPitchLabModelCandidates, pitchLabErrorMessage } from "@/lib/pitch-lab-models";
import { getActivePitchLabFramework } from "@/lib/ai/pitch-lab-framework";
import {
  buildPitchLabPremiseRefinementPrompt,
  buildPitchLabPremiseRefinementSystemPrompt,
  buildPitchLabRefinementPrompt,
  buildPitchLabRefinementSystemPrompt,
  cleanPitchLabTitle,
  isValidPitchLabTitle,
} from "@/lib/ai/pitch-lab-prompts";
import { requirePitchLabAccess } from "@/lib/pitch-lab-access";
import { ensurePitchLabOwner } from "@/lib/pitch-lab-owner";

function buildCompactPriorTurns(turns: ReturnType<typeof parsePitchIdeaEnvelope>["turns"]): string {
  const rewriteTurns = turns.filter((turn) => turn.kind === "rewrite");
  if (!rewriteTurns.length) return "None.";
  const recentTurns = rewriteTurns.slice(-3);
  const olderCount = Math.max(0, rewriteTurns.length - recentTurns.length);
  const olderNote = olderCount ? String(olderCount) + " older refinement turn" + (olderCount === 1 ? "" : "s") + " omitted from model context." : "";
  const recentNote = recentTurns.map((turn, index) => {
    const absoluteIndex = olderCount + index + 1;
    const ideaText = cleanPitchIdeaText(turn.ideaText);
    const result = ideaText.length > 700 ? ideaText.slice(0, 700).trim() + "..." : ideaText;
    return "Turn " + absoluteIndex + " instruction: " + turn.instruction + "\nTurn " + absoluteIndex + " result excerpt: " + result;
  }).join("\n\n");
  return [olderNote, recentNote].filter(Boolean).join("\n\n");
}
function parseRefinedIdea(raw: string, fallbackTitle: string): { title: string; ideaText: string; kernel?: string; beats?: string; clarityChecks?: string; adaptationNotes?: string } {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(clean);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.title === "string" && typeof record.ideaText === "string") {
        return {
          title: record.title.trim().slice(0, 160) || fallbackTitle,
          ideaText: record.ideaText.trim(),
          kernel: typeof record.kernel === "string" ? record.kernel.trim() : undefined,
          beats: typeof record.beats === "string" ? record.beats.trim() : undefined,
          clarityChecks: typeof record.clarityChecks === "string" ? record.clarityChecks.trim() : undefined,
          adaptationNotes: typeof record.adaptationNotes === "string" ? record.adaptationNotes.trim() : undefined,
        };
      }
    }
  } catch {
    // Fall back to plain paragraph output from older model behavior.
  }
  return { title: fallbackTitle, ideaText: clean };
}

function parseRefinedPremise(raw: string, fallbackTitle: string): { title: string; premiseText: string; appealLane?: string; transformationNotes?: string } {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(clean);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The model returned an invalid idea.");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.premiseText !== "string") {
    throw new Error("The model returned an invalid idea.");
  }
  return {
    title: typeof record.title === "string" ? record.title.trim().slice(0, 160) || fallbackTitle : fallbackTitle,
    premiseText: record.premiseText.trim(),
    appealLane: typeof record.appealLane === "string" ? record.appealLane.trim() : undefined,
    transformationNotes: typeof record.transformationNotes === "string" ? record.transformationNotes.trim() : undefined,
  };
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
  const ideaText = typeof body?.ideaText === "string" ? cleanPitchIdeaText(body.ideaText) : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const turnIndex = typeof body?.turnIndex === "number" && Number.isInteger(body.turnIndex) ? body.turnIndex : null;
  if (!ideaId || !ideaText) return NextResponse.json({ error: "Idea text is required." }, { status: 400 });
  if (title && !isValidPitchLabTitle(title)) return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  const idea = await db.query.pitchIdeas.findFirst({ where: and(eq(pitchIdeas.id, ideaId), eq(pitchIdeas.workspaceId, workspace.id)) });
  if (!idea || !["premise", "generated", "shortlisted"].includes(idea.status)) return NextResponse.json({ error: "Choose an idea before refining." }, { status: 404 });

  const envelope = parsePitchIdeaEnvelope(idea.ideaText);
  if (turnIndex !== null && !instruction) {
    if (idea.status === "premise") return NextResponse.json({ error: "Generated option not found." }, { status: 404 });
    const turn = envelope.turns[turnIndex];
    if (!turn || turn.kind !== "rewrite") return NextResponse.json({ error: "Generated option not found." }, { status: 404 });
    const storedEnvelope = serializePitchIdeaEnvelope({
      ...envelope,
      turns: envelope.turns.map((item, index) => index === turnIndex ? { ...item, ideaText } : item),
    });
    await db.update(pitchIdeas).set({
      ideaText: storedEnvelope,
      updatedAt: new Date(),
    }).where(eq(pitchIdeas.id, ideaId));
    return NextResponse.json({ ideaText: storedEnvelope, currentText: envelope.currentText, title: idea.title, isPlaceholder: idea.title.startsWith(PITCH_LAB_SAMPLE_TITLE_PREFIX) });
  }
  let updatedTitle = title || idea.title.replace(PITCH_LAB_SAMPLE_TITLE_PREFIX, "");
  let updatedText = cleanPitchIdeaText(ideaText);
  let isPlaceholder = idea.title.startsWith(PITCH_LAB_SAMPLE_TITLE_PREFIX);
  let refinedIdea: ReturnType<typeof parseRefinedIdea> | null = null;
  let refinedPremise: ReturnType<typeof parseRefinedPremise> | null = null;
  const isPremise = idea.status === "premise";
  if (instruction) {
    if (isPitchLabSampleMode()) {
      // Keep local flow tests usable without sending a paid request to a model.
      updatedText = cleanPitchIdeaText(ideaText);
      isPlaceholder = true;
    } else {
      const providers = await getConfiguredProviders();
      const candidates = getPitchLabModelCandidates(providers);
      if (!candidates.length) return NextResponse.json({ error: "No AI provider is configured. Ask an admin to add an API key." }, { status: 503 });
      let lastError: unknown = null;
      const tasteBrief = await getActivePitchLabFramework();
      const priorTurns = buildCompactPriorTurns(envelope.turns);
      for (const candidate of candidates) {
        try {
          const result = await generateText({
            model: await getAIModel(candidate.modelId),
            system: isPremise
              ? buildPitchLabPremiseRefinementSystemPrompt(tasteBrief)
              : buildPitchLabRefinementSystemPrompt(tasteBrief),
            prompt: isPremise
              ? buildPitchLabPremiseRefinementPrompt({
                currentTitle: updatedTitle,
                currentText: ideaText,
                originalText: envelope.originalText,
                priorTurns,
                instruction,
                transformationNotes: envelope.adaptationNotes,
              })
              : buildPitchLabRefinementPrompt({
                currentTitle: updatedTitle,
                currentText: ideaText,
                originalText: envelope.originalText,
                priorTurns,
                instruction,
                premise: envelope.premise,
                kernel: envelope.kernel,
                beats: envelope.beats,
                clarityChecks: envelope.clarityChecks,
                adaptationNotes: envelope.adaptationNotes,
              }),
            maxOutputTokens: isPremise ? 1200 : 2400,
            maxRetries: 0,
          });
          if (isPremise) refinedPremise = parseRefinedPremise(result.text, updatedTitle);
          else refinedIdea = parseRefinedIdea(result.text, updatedTitle);
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
      if (!refinedIdea && !refinedPremise) {
        return NextResponse.json({ error: `All configured AI providers failed. Last error: ${pitchLabErrorMessage(lastError)}` }, { status: 502 });
      }
      updatedTitle = refinedPremise?.title ?? refinedIdea!.title;
      updatedText = cleanPitchIdeaText(refinedPremise?.premiseText ?? refinedIdea!.ideaText);
      if (!updatedText) return NextResponse.json({ error: "The model returned an empty idea." }, { status: 502 });
      if (!isValidPitchLabTitle(updatedTitle)) return NextResponse.json({ error: "The model returned a title longer than two words. Try a simpler refinement." }, { status: 502 });
    }
  }

  const cleanTitle = cleanPitchLabTitle((instruction && !isPremise ? idea.title : updatedTitle).replace(/^\[Sample\]\s*/i, ""));
  if (!isValidPitchLabTitle(cleanTitle)) return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  const currentText = isPremise || !instruction ? updatedText : cleanPitchIdeaText(envelope.currentText || ideaText);
  const adaptationNotes = refinedPremise
    ? [refinedPremise.appealLane, refinedPremise.transformationNotes].filter(Boolean).join(" | ")
    : envelope.adaptationNotes;
  const storedEnvelope = serializePitchIdeaEnvelope({
    originalText: envelope.originalText || currentText || updatedText,
    currentText,
    turns: instruction
      ? [...envelope.turns, {
          instruction,
          ideaText: updatedText,
          createdAt: new Date().toISOString(),
          kind: isPremise ? "rerun" as const : "rewrite" as const,
          kernel: refinedIdea?.kernel || envelope.kernel,
          beats: refinedIdea?.beats || envelope.beats,
          clarityChecks: refinedIdea?.clarityChecks || envelope.clarityChecks,
          adaptationNotes: refinedIdea?.adaptationNotes || adaptationNotes,
        }]
      : isPremise && updatedText !== envelope.currentText
        ? [...envelope.turns, { instruction: "Manual edit", ideaText: updatedText, createdAt: new Date().toISOString(), kind: "manual_edit" as const }]
        : envelope.turns,
    premise: isPremise ? currentText : envelope.premise,
    premiseId: envelope.premiseId,
    batchId: envelope.batchId,
    batchNumber: envelope.batchNumber,
    generatedAt: envelope.generatedAt,
    shortlistedAt: envelope.shortlistedAt,
    kernel: envelope.kernel,
    beats: envelope.beats,
    clarityChecks: envelope.clarityChecks,
    adaptationNotes,
  });
  await db.update(pitchIdeas).set({
    title: cleanTitle,
    ideaText: storedEnvelope,
    updatedAt: new Date(),
  }).where(eq(pitchIdeas.id, ideaId));
  return NextResponse.json({ ideaText: storedEnvelope, currentText, title: cleanTitle, isPlaceholder });
}
