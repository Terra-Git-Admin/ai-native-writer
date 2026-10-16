import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAIModel, getConfiguredProviders, getPitchLabArgonModel, getPitchLabGeminiModel } from "@/lib/ai/providers";
import { db } from "@/lib/db";
import { pitchIdeas, pitchWorkspaces } from "@/lib/db/schema";
import { isPitchLabSampleMode, PITCH_LAB_SAMPLE_TITLE_PREFIX } from "@/lib/ai/pitch-lab-samples";
import { cleanPitchIdeaText, parsePitchIdeaEnvelope, serializePitchIdeaEnvelope, type PitchLabFeedback, type PitchLabWriterContext } from "@/lib/pitch-lab-idea-envelope";
import { getPitchLabModelCandidates, pitchLabErrorMessage } from "@/lib/pitch-lab-models";
import { getActivePitchLabFramework } from "@/lib/ai/pitch-lab-framework";
import {
  buildPitchLabPremiseRefinementPrompt,
  buildPitchLabPremiseRefinementSystemPrompt,
  buildPitchLabRefinementPrompt,
  buildPitchLabRefinementSystemPrompt,
  buildPitchLabEpisodeRefinementPrompt,
  buildPitchLabEpisodeRefinementSystemPrompt,
  PITCH_LAB_SHORTLIST_PROMPT_VERSION,
  cleanPitchLabTitle,
  isValidPitchLabTitle,
} from "@/lib/ai/pitch-lab-prompts";
import { assertPitchLabPilotOptionText } from "@/lib/ai/pitch-lab-pilot-option-format";
import { assertPitchLabPilotPlotText } from "@/lib/ai/pitch-lab-pilot-plot-format";
import { assertPitchLabEpisodePilotText } from "@/lib/ai/pitch-lab-episode-pilot";
import { assertPitchLabIdeaSeedText } from "@/lib/ai/pitch-lab-idea-seed-format";
import { getPitchLabContentState } from "@/lib/ai/pitch-lab-content-contract";
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

function mergeWriterContext(...contexts: Array<PitchLabWriterContext | undefined>): PitchLabWriterContext | undefined {
  const merged = contexts.reduce<PitchLabWriterContext>((acc, context) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(context ?? {}).filter(([, value]) => typeof value === "string" && value.trim())),
  }), {});
  return Object.values(merged).some(Boolean) ? merged : undefined;
}

function formatWriterContext(context: PitchLabWriterContext | undefined): string {
  if (!context) return "";
  const lines = [
    "WRITER CONTEXT - CARRY THIS THROUGH",
    context.workspaceBrief ? `- Original writer brief: ${context.workspaceBrief}` : "",
    context.latestInstruction ? `- Latest writer instruction: ${context.latestInstruction}` : "",
    context.selectedIdea ? `- Selected Idea: ${context.selectedIdea}` : "",
    context.selectedPilotOption ? `- Selected Pilot Option: ${context.selectedPilotOption}` : "",
    context.carriedNotes ? `- Carried notes: ${context.carriedNotes}` : "",
  ].filter(Boolean);
  return lines.length > 1 ? lines.join("\n") : "";
}
function parseRefinedPilotPlot(raw: string, fallbackTitle: string): { title: string; ideaText: string; kernel?: string; beats?: string; clarityChecks?: string; adaptationNotes?: string } {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(clean);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (typeof record.title === "string" && typeof record.ideaText === "string") {
      return {
        title: record.title.trim().slice(0, 160) || fallbackTitle,
        ideaText: assertPitchLabPilotPlotText(record.ideaText.trim()),
        kernel: typeof record.kernel === "string" ? record.kernel.trim() : undefined,
        beats: typeof record.beats === "string" ? record.beats.trim() : undefined,
        clarityChecks: typeof record.clarityChecks === "string" ? record.clarityChecks.trim() : undefined,
        adaptationNotes: typeof record.adaptationNotes === "string" ? record.adaptationNotes.trim() : undefined,
      };
    }
  }
  throw new Error("The model returned an invalid Pilot Plot.");
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
    premiseText: assertPitchLabIdeaSeedText(record.premiseText.trim()),
    appealLane: typeof record.appealLane === "string" ? record.appealLane.trim() : undefined,
    transformationNotes: typeof record.transformationNotes === "string" ? record.transformationNotes.trim() : undefined,
  };
}

function buildSampleEpisodePitch(input: { title: string; optionText: string; premise?: string; instruction: string }): string {
  const premise = input.premise ? input.premise.replace(/\s+/g, " ").slice(0, 110) : "the selected Idea";
  const instruction = input.instruction ? input.instruction.replace(/\s+/g, " ").slice(0, 90) : "make the pressure sharper";
  return [
    `Opening: ${input.title} opens with the heroine forced to act on ${premise} while the opposing lead needs her choice now`,
    `Plot progression: ${instruction} turns the room against her and makes his protection useful but costly`,
    "Final cliffhanger: The bargain becomes public and locks her into his next immediate demand",
  ].join("\n");
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
  const feedback = body?.feedback && typeof body.feedback === "object" && !Array.isArray(body.feedback)
    ? body.feedback as { rating?: unknown; reason?: unknown }
    : null;
  if (!ideaId) return NextResponse.json({ error: "Pitch Lab item not found." }, { status: 404 });
  if (!ideaText && !feedback) return NextResponse.json({ error: "Pitch Lab text is required." }, { status: 400 });
  if (title && !isValidPitchLabTitle(title)) return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ error: "Pitch Lab item not found." }, { status: 404 });
  const idea = await db.query.pitchIdeas.findFirst({ where: and(eq(pitchIdeas.id, ideaId), eq(pitchIdeas.workspaceId, workspace.id)) });
  if (!idea || !["premise", "generated", "shortlisted"].includes(idea.status)) return NextResponse.json({ error: "Choose an Idea, Pilot Option, or Pilot Plot before refining." }, { status: 404 });

  const envelope = parsePitchIdeaEnvelope(idea.ideaText);
  const existingState = getPitchLabContentState(idea.status, idea.ideaText);
  if (!existingState.isValid && !feedback) {
    return NextResponse.json({ error: "This Pitch Lab item is invalid legacy content. Regenerate it before continuing." }, { status: 400 });
  }
  if (feedback) {
    const rating = feedback.rating === "up" || feedback.rating === "down" ? feedback.rating : null;
    const reason = typeof feedback.reason === "string" ? feedback.reason.trim().slice(0, 1000) : "";
    if (!rating) return NextResponse.json({ error: "Choose thumbs up or thumbs down." }, { status: 400 });
    if (rating === "down" && !reason) return NextResponse.json({ error: "Add a reason for thumbs down." }, { status: 400 });
    const savedFeedback: PitchLabFeedback = { rating, reason: reason || undefined, updatedAt: new Date().toISOString() };
    if (turnIndex !== null && (!envelope.turns[turnIndex] || envelope.turns[turnIndex].kind !== "rewrite" || idea.status !== "shortlisted")) {
      return NextResponse.json({ error: "Pilot revision not found." }, { status: 404 });
    }
    const storedEnvelope = serializePitchIdeaEnvelope(turnIndex !== null
      ? { ...envelope, turns: envelope.turns.map((turn, index) => index === turnIndex ? { ...turn, feedback: savedFeedback } : turn) }
      : { ...envelope, feedback: savedFeedback });
    await db.update(pitchIdeas).set({
      ideaText: storedEnvelope,
      updatedAt: new Date(),
    }).where(eq(pitchIdeas.id, ideaId));
    return NextResponse.json({ ideaText: storedEnvelope, currentText: envelope.currentText, title: idea.title, isPlaceholder: idea.title.startsWith(PITCH_LAB_SAMPLE_TITLE_PREFIX) });
  }
  if (turnIndex !== null && !instruction) {
    if (idea.status === "premise") return NextResponse.json({ error: "Generated option not found." }, { status: 404 });
    const turn = envelope.turns[turnIndex];
    if (!turn || turn.kind !== "rewrite") return NextResponse.json({ error: "Generated option not found." }, { status: 404 });
    const storedEnvelope = serializePitchIdeaEnvelope({
      ...envelope,
      turns: envelope.turns.map((item, index) => index === turnIndex ? { ...item, ideaText: item.contentKind === "episode_pilot" ? assertPitchLabEpisodePilotText(ideaText) : assertPitchLabPilotPlotText(ideaText), contentKind: item.contentKind === "episode_pilot" ? "episode_pilot" as const : "pilot_plot" as const } : item),
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
  let refinedIdea: ReturnType<typeof parseRefinedPilotPlot> | null = null;
  let refinedPremise: ReturnType<typeof parseRefinedPremise> | null = null;
  const isPremise = idea.status === "premise";
  const isEpisodePilot = existingState.contentKind === "episode_pilot";
  const writerContext = mergeWriterContext(envelope.writerContext, {
    workspaceBrief: workspace.brief || undefined,
    latestInstruction: instruction || envelope.writerContext?.latestInstruction,
    selectedIdea: isPremise ? updatedText : envelope.premise,
    selectedPilotOption: !isPremise ? envelope.originalText || ideaText : undefined,
    carriedNotes: envelope.adaptationNotes,
  });
  const writerContextBlock = formatWriterContext(writerContext);
  if (!isPremise && instruction && idea.status !== "shortlisted") {
    return NextResponse.json({ error: "Move a valid Pilot Option to Shortlist before developing a Pilot Plot." }, { status: 400 });
  }
  if (instruction) {
    if (isPitchLabSampleMode()) {
      // Keep local flow tests usable without sending a paid request to a model.
      updatedText = isPremise
        ? assertPitchLabIdeaSeedText(ideaText)
        : buildSampleEpisodePitch({
          title: updatedTitle,
          optionText: ideaText,
          premise: envelope.premise,
          instruction,
        });
      isPlaceholder = true;
    } else if (isEpisodePilot) {
      try {
        const result = await generateText({
          model: await getPitchLabGeminiModel(),
          system: buildPitchLabEpisodeRefinementSystemPrompt(),
          prompt: buildPitchLabEpisodeRefinementPrompt({ premise: envelope.premise || "", current: updatedText, instruction }),
          maxOutputTokens: 6000,
          maxRetries: 0,
          providerOptions: { google: { thinkingConfig: { thinkingLevel: "high" } } },
        });
        updatedText = assertPitchLabEpisodePilotText(result.text);
        console.info("[pitch-lab] episode-pilot-refinement", { modelId: result.response.modelId, finishReason: result.finishReason, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, reasoningTokens: result.usage.outputTokenDetails.reasoningTokens, promptVersion: PITCH_LAB_SHORTLIST_PROMPT_VERSION });
      } catch (error) {
        return NextResponse.json({ error: pitchLabErrorMessage(error) }, { status: 502 });
      }
    } else {
      const providers = await getConfiguredProviders();
      const candidates = isPremise
        ? (providers.includes("google") ? [{ provider: "google" as const, modelId: "gemini-4-argon" }] : [])
        : getPitchLabModelCandidates(providers);
      if (!candidates.length) return NextResponse.json({ error: isPremise ? "Idea seed edits require a configured Google/Gemini API key for Argon." : "No AI provider is configured. Ask an admin to add an API key." }, { status: 503 });
      let lastError: unknown = null;
      const tasteBrief = await getActivePitchLabFramework();
      const priorTurns = buildCompactPriorTurns(envelope.turns);
      for (const candidate of candidates) {
        try {
          const result = await generateText({
            model: isPremise ? await getPitchLabArgonModel() : await getAIModel(candidate.modelId),
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
                writerContext: writerContextBlock,
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
                writerContext: writerContextBlock,
              }),
            maxOutputTokens: isPremise ? 32768 : 2400,
            maxRetries: 0,
            ...(isPremise ? { providerOptions: { google: { thinkingConfig: { thinkingLevel: "medium" } } } } : {}),
          });
          if (isPremise) refinedPremise = parseRefinedPremise(result.text, updatedTitle);
          else refinedIdea = parseRefinedPilotPlot(result.text, updatedTitle);
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
      if (!updatedText) return NextResponse.json({ error: "The model returned empty Pitch Lab text." }, { status: 502 });
      if (!isValidPitchLabTitle(updatedTitle)) return NextResponse.json({ error: "The model returned a title longer than two words. Try a simpler refinement." }, { status: 502 });
    }
  }

  if (!isPremise) {
    try {
      updatedText = isEpisodePilot
        ? assertPitchLabEpisodePilotText(updatedText)
        : instruction || existingState.contentKind === "pilot_plot"
          ? assertPitchLabPilotPlotText(updatedText)
          : assertPitchLabPilotOptionText(updatedText);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Pilot Plot must use Opening, Plot progression, and Final cliffhanger.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
  if (isPremise) {
    try {
      updatedText = assertPitchLabIdeaSeedText(updatedText);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Idea must use compact FL/ML seed format.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const cleanTitle = cleanPitchLabTitle((instruction && !isPremise ? idea.title : updatedTitle).replace(/^\[Sample\]\s*/i, ""));
  if (!isValidPitchLabTitle(cleanTitle)) return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  const nextContentKind = isPremise ? "idea_seed" as const : isEpisodePilot ? "episode_pilot" as const : instruction ? "pilot_plot" as const : (existingState.contentKind ?? "pilot_option");
  const currentText = updatedText;
  const adaptationNotes = refinedPremise
    ? [refinedPremise.appealLane, refinedPremise.transformationNotes].filter(Boolean).join(" | ")
    : envelope.adaptationNotes;
  const storedEnvelope = serializePitchIdeaEnvelope({
    originalText: envelope.originalText || currentText || updatedText,
    currentText,
    contentKind: nextContentKind,
    turns: instruction
      ? [...envelope.turns, {
          instruction,
          ideaText: updatedText,
          createdAt: new Date().toISOString(),
          kind: isPremise ? "rerun" as const : "rewrite" as const,
          contentKind: nextContentKind,
          generation: isEpisodePilot ? { provider: "google", model: "gemini-3.1-pro-preview", pipeline: "episode-pilot-refinement", promptVersion: PITCH_LAB_SHORTLIST_PROMPT_VERSION, thinkingLevel: "high" } : undefined,
          kernel: refinedIdea?.kernel || envelope.kernel,
          beats: refinedIdea?.beats || envelope.beats,
          clarityChecks: refinedIdea?.clarityChecks || envelope.clarityChecks,
          adaptationNotes: refinedIdea?.adaptationNotes || adaptationNotes,
          writerContext,
        }]
      : updatedText !== envelope.currentText
        ? [...envelope.turns, { instruction: "Manual edit", ideaText: updatedText, createdAt: new Date().toISOString(), kind: "manual_edit" as const, contentKind: nextContentKind, writerContext }]
        : envelope.turns,
    premise: isPremise ? currentText : envelope.premise,
    premiseId: envelope.premiseId,
    batchId: envelope.batchId,
    batchNumber: envelope.batchNumber,
    feedback: envelope.feedback,
    generation: envelope.generation,
    generatedAt: envelope.generatedAt,
    shortlistedAt: envelope.shortlistedAt,
    kernel: refinedIdea?.kernel || envelope.kernel,
    beats: refinedIdea?.beats || envelope.beats,
    clarityChecks: refinedIdea?.clarityChecks || envelope.clarityChecks,
    adaptationNotes: refinedIdea?.adaptationNotes || adaptationNotes,
    writerContext,
  });
  await db.update(pitchIdeas).set({
    title: cleanTitle,
    ideaText: storedEnvelope,
    updatedAt: new Date(),
  }).where(eq(pitchIdeas.id, ideaId));
  return NextResponse.json({ ideaText: storedEnvelope, currentText, title: cleanTitle, isPlaceholder });
}
