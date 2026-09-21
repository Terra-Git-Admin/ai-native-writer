import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, pitchIdeas, pitchSources, pitchWorkspaces, tabs } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { getAIModel, getConfiguredProviders } from "@/lib/ai/providers";
import { getActivePitchLabFramework } from "@/lib/ai/pitch-lab-framework";
import { buildPitchLabSampleIdeas, isPitchLabSampleMode } from "@/lib/ai/pitch-lab-samples";
import { requirePitchLabAdmin } from "@/lib/pitch-lab-access";
import { ensurePitchLabOwner } from "@/lib/pitch-lab-owner";
import { getPitchLabModelCandidates, pitchLabErrorMessage } from "@/lib/pitch-lab-models";
import {
  buildPitchLabGenerationPrompt,
  buildPitchLabGenerationSystemPrompt,
  cleanPitchLabTitle,
  isValidPitchLabTitle,
  PITCH_LAB_IDEA_COUNT,
} from "@/lib/ai/pitch-lab-prompts";
import { loadExternalStorySource } from "@/lib/ai/pitch-lab-source-url";

const SOURCE_LIMIT = 60_000;

function parseIdeas(text: string): { title: string; ideaText: string }[] {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Some providers emit literal line breaks or tabs inside quoted JSON values.
  // Escape those control characters before parsing so valid plot text is retained.
  let inString = false;
  let escaped = false;
  let repaired = "";
  for (const character of clean) {
    const code = character.charCodeAt(0);
    if (inString && !escaped && code < 0x20) {
      repaired += code === 0x0a ? "\\n" : code === 0x0d ? "\\r" : code === 0x09 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    repaired += character;
    if (inString && escaped) escaped = false;
    else if (inString && character === "\\") escaped = true;
    else if (character === '"') inString = !inString;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired);
  } catch {
    throw new Error("The model returned an unreadable idea list. Your current ideas are unchanged; try generating again.");
  }
  if (!Array.isArray(parsed)) throw new Error("The model returned an invalid idea list.");
  const ideas = parsed.map((item) => {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.title !== "string" || typeof candidate.ideaText !== "string") return null;
    const title = cleanPitchLabTitle(candidate.title);
    const ideaText = candidate.ideaText.trim();
    return title && ideaText && isValidPitchLabTitle(title) ? { title, ideaText } : null;
  }).filter((idea): idea is { title: string; ideaText: string } => Boolean(idea));
  if (ideas.length !== PITCH_LAB_IDEA_COUNT) throw new Error(`The model returned ${ideas.length} valid ideas with one- or two-word titles; expected ${PITCH_LAB_IDEA_COUNT}. Please regenerate.`);
  return ideas;
}

function getTextFromHtml(html: string | null): string {
  const value = html ?? "";
  try {
    const parsed: unknown = JSON.parse(value);
    const parts: string[] = [];
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const record = node as { type?: unknown; text?: unknown; content?: unknown };
      if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
      if (Array.isArray(record.content)) {
        record.content.forEach(visit);
        if (["paragraph", "heading", "listItem", "blockquote"].includes(String(record.type))) parts.push("\n");
      }
    };
    visit(parsed);
    if (parts.length) return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    // Legacy documents may store HTML rather than Tiptap JSON.
  }
  return value
    .replace(/<\/(p|h[1-6]|li|div|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(req: Request) {
  const session = await auth();
  const accessError = requirePitchLabAdmin(session);
  if (accessError) return accessError;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensurePitchLabOwner(session);

  const body = await req.json().catch(() => null);
  const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
  const sourceDocumentId = typeof body?.sourceDocumentId === "string" ? body.sourceDocumentId : null;
  const pastedSource = typeof body?.pastedSource === "string" ? body.pastedSource.trim() : "";
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const generationType = body?.generationType === "adaptation" ? "adaptation" : "framework";
  const adaptationStyle = body?.adaptationStyle === "close" ? "close" : "loose";
  if (generationType === "adaptation" && !sourceDocumentId && !pastedSource && !sourceUrl) {
    return NextResponse.json({ error: "Choose a Writer story, add a public story link, or paste story material to adapt." }, { status: 400 });
  }

  const sources: { type: "writer_doc" | "pasted_text"; sourceDocumentId: string | null; title: string; text: string }[] = [];
  if (generationType === "adaptation" && sourceDocumentId) {
    const [sourceDoc] = await db.select({ id: documents.id, title: documents.title })
      .from(documents).where(eq(documents.id, sourceDocumentId)).limit(1);
    if (!sourceDoc) return NextResponse.json({ error: "The selected Writer document was not found." }, { status: 404 });
    const sourceTabs = await db.select({ title: tabs.title, content: tabs.content }).from(tabs)
      .where(eq(tabs.documentId, sourceDocumentId)).orderBy(tabs.position);
    sources.push({ type: "writer_doc", sourceDocumentId, title: sourceDoc.title, text: `Writer document: ${sourceDoc.title}\n${sourceTabs.map((tab) => `${tab.title}\n${getTextFromHtml(tab.content)}`).join("\n\n")}` });
  }
  if (generationType === "adaptation" && pastedSource) sources.push({ type: "pasted_text", sourceDocumentId: null, title: "Pasted source material", text: `Pasted source material:\n${pastedSource}` });
  if (generationType === "adaptation" && sourceUrl) {
    try {
      const externalSource = await loadExternalStorySource(sourceUrl);
      sources.push({ type: "pasted_text", sourceDocumentId: null, title: externalSource.title, text: externalSource.text });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read that story link.";
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }
  const sourceMaterial = sources.map((source) => source.text).join("\n\n---\n\n").slice(0, SOURCE_LIMIT);

  let parsedIdeas: { title: string; ideaText: string }[] | null = null;
  let isPlaceholder = false;
  try {
    if (isPitchLabSampleMode()) {
      parsedIdeas = buildPitchLabSampleIdeas({
        generationType,
        adaptationStyle,
        sourceTitle: sources.map((source) => source.title).join(" + ") || "the selected story",
      }).slice(0, PITCH_LAB_IDEA_COUNT);
      isPlaceholder = true;
    } else {
      const providers = await getConfiguredProviders();
      const framework = await getActivePitchLabFramework();
      const candidates = getPitchLabModelCandidates(providers);
      if (!candidates.length) return NextResponse.json({ error: "No AI provider is configured. Ask an admin to add an API key." }, { status: 503 });

      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          const result = await generateText({
            model: await getAIModel(candidate.modelId),
            system: buildPitchLabGenerationSystemPrompt(framework),
            prompt: buildPitchLabGenerationPrompt({ generationType, adaptationStyle, brief, instruction, sourceMaterial }),
            maxOutputTokens: 14000,
            maxRetries: 0,
          });
          parsedIdeas = parseIdeas(result.text);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          console.warn("[pitch-lab] idea generation provider failed", {
            provider: candidate.provider,
            modelId: candidate.modelId,
            error: pitchLabErrorMessage(err),
          });
        }
      }
      if (!parsedIdeas) {
        return NextResponse.json({ error: `All configured AI providers failed. Last error: ${pitchLabErrorMessage(lastError)}` }, { status: 502 });
      }
    }

    if (!parsedIdeas) throw new Error("Idea generation returned no ideas.");
    const ideasToSave = parsedIdeas;
    const saved = db.transaction((tx) => {
      const now = new Date();
      let workspaceId = tx.select({ id: pitchWorkspaces.id }).from(pitchWorkspaces)
        .where(eq(pitchWorkspaces.ownerId, session.user.id)).get()?.id ?? null;
      if (!workspaceId) {
        workspaceId = nanoid(12);
        tx.insert(pitchWorkspaces).values({ id: workspaceId, ownerId: session.user.id, brief, adaptationStyle: sourceMaterial ? adaptationStyle : null, createdAt: now, updatedAt: now }).run();
      } else {
        tx.update(pitchWorkspaces).set({ brief, adaptationStyle: sourceMaterial ? adaptationStyle : null, updatedAt: now })
          .where(eq(pitchWorkspaces.id, workspaceId)).run();
      }
      tx.delete(pitchSources).where(eq(pitchSources.workspaceId, workspaceId)).run();
      if (sources.length) tx.insert(pitchSources).values(sources.map((source) => ({
        id: nanoid(12), workspaceId: workspaceId!, type: source.type, sourceDocumentId: source.sourceDocumentId,
        title: source.title, textSnapshot: source.text.slice(0, SOURCE_LIMIT), createdAt: now,
      }))).run();
      // A new generation replaces unsorted ideas. Shortlisted ideas and the small discarded collection stay available.
      tx.delete(pitchIdeas).where(and(
        eq(pitchIdeas.workspaceId, workspaceId),
        eq(pitchIdeas.status, "generated"),
      )).run();
      const existingRows = tx.select({ position: pitchIdeas.position }).from(pitchIdeas)
        .where(eq(pitchIdeas.workspaceId, workspaceId)).all();
      const startPosition = existingRows.length ? Math.max(...existingRows.map((row) => row.position)) + 1 : 0;
      const generated = ideasToSave.map((idea, index) => ({
        id: nanoid(12), workspaceId: workspaceId!,
        title: idea.title.replace(/^\[Sample\]\s*/i, ""),
        ideaText: idea.ideaText,
        status: "generated" as const, position: startPosition + index, createdAt: now, updatedAt: now,
      }));
      tx.insert(pitchIdeas).values(generated).run();
      return { workspaceId, ideas: generated };
    });
    return NextResponse.json({ ...saved, isPlaceholder });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Idea generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
