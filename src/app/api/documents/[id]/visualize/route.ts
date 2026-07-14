import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tabs, aiSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { tiptapJsonToTagged, splitTabByH3 } from "@/lib/ai/context-engine";

const PROMPT_GEN_SYSTEM = `You are creating storyboard frames for a microdrama episode. The goal is NOT cinematic technique — no shot types, camera angles, or lighting terminology. The goal is to communicate story: what is happening, who is feeling what, where this takes place, and what is being said or decided.

Given beats in the format "Visual | Dialogue | V.O.", produce one image description per beat that answers:
- WHO is present, and what is their relationship or emotional state toward each other right now?
- WHERE are they — and does the setting reflect the story moment (a tense office, a quiet bedroom, a crowded street)?
- WHAT is being communicated — what does the dialogue or V.O. mean for these characters, and how does it show on their faces, body language, or what they are doing?
- WHAT has just happened or is about to happen — what story development does this frame carry?

Rules:
- 2–4 sentences. Concrete, specific, no vague words ("beautiful", "tense atmosphere", "emotional moment")
- The dialogue and V.O. are your clues to the emotional truth — translate that into what you would literally see on someone's face or in their posture
- Do NOT describe camera work or shot composition
- Do NOT quote dialogue directly
- The frame should make sense to someone who has never seen the series — describe people, place, and feeling, not character names or plot shorthand

Return ONLY a valid JSON array. No markdown, no commentary, no fences:
[{ "beatIndex": 0, "prompt": "..." }, { "beatIndex": 1, "prompt": "..." }, ...]`;

interface StoryboardFrame {
  beatIndex: number;
  beatText: string;
  prompt: string;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

async function callImagen3(
  apiKey: string,
  prompt: string
): Promise<{ imageBase64: string; mimeType: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: "16:9" },
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Imagen 3 returned ${res.status}: ${text}`);
  }
  const data = await res.json() as {
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
  };
  const prediction = data.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) {
    throw new Error("No image data in Imagen 3 response");
  }
  return {
    imageBase64: prediction.bytesBase64Encoded,
    mimeType: prediction.mimeType ?? "image/png",
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const isAdmin = (session?.user as { role?: string })?.role === "admin";
  if (!session?.user || !isAdmin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id: documentId } = await params;

  let episodeIndex: number | undefined;
  try {
    const body = await request.json().catch(() => ({})) as { episodeIndex?: number };
    if (typeof body.episodeIndex === "number") episodeIndex = body.episodeIndex;
  } catch {
    // ignored — episodeIndex stays undefined (= latest)
  }

  const googleSettings = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.id, "google"),
  });
  if (!googleSettings) {
    return NextResponse.json(
      { error: "No Google API key configured. Ask an admin to add it in Settings." },
      { status: 503 }
    );
  }
  const apiKey = decrypt(googleSettings.apiKey);

  const tabRows = await db.query.tabs.findMany({
    where: eq(tabs.documentId, documentId),
  });
  const predefinedTab = tabRows.find((t) => t.type === "predefined_episodes");
  if (!predefinedTab) {
    return NextResponse.json(
      { error: "No Predefined Episodes tab found in this document." },
      { status: 404 }
    );
  }

  const tagged = tiptapJsonToTagged(predefinedTab.content);
  const sections = splitTabByH3(tagged);
  if (sections.length === 0) {
    return NextResponse.json(
      { error: "No episodes found in the Predefined Episodes tab." },
      { status: 400 }
    );
  }

  const idx = episodeIndex != null
    ? Math.min(Math.max(0, episodeIndex), sections.length - 1)
    : sections.length - 1;
  const episode = sections[idx];

  const beatLines = episode.content
    .split("\n")
    .filter((l) => l.startsWith("[P]"))
    .map((l) => l.replace(/^\[P\]\s*/, "").trim())
    .filter((l) => l.length > 0);

  if (beatLines.length === 0) {
    return NextResponse.json(
      { error: `Episode "${episode.title}" has no beats to visualize.` },
      { status: 400 }
    );
  }

  // Step 1: One LLM call → N image prompts as JSON
  const google = createGoogleGenerativeAI({ apiKey });
  let imagePrompts: { beatIndex: number; prompt: string }[];
  try {
    const numbered = beatLines
      .map((line, i) => `Beat ${i}: ${line}`)
      .join("\n");
    const { text } = await generateText({
      model: google("gemini-2.5-flash"),
      system: PROMPT_GEN_SYSTEM,
      prompt: `## ${episode.title}\n\n${numbered}`,
    });
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    imagePrompts = JSON.parse(cleaned) as { beatIndex: number; prompt: string }[];
    if (!Array.isArray(imagePrompts)) throw new Error("LLM returned non-array JSON");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to generate image prompts: ${msg}` },
      { status: 502 }
    );
  }

  // Step 2: Parallel Imagen 3 calls — one per beat
  const results = await Promise.allSettled(
    beatLines.map(async (beatText, i): Promise<StoryboardFrame> => {
      const promptEntry = imagePrompts.find((p) => p.beatIndex === i) ?? imagePrompts[i];
      const prompt = promptEntry?.prompt ?? beatText;
      try {
        const img = await callImagen3(apiKey, prompt);
        return { beatIndex: i, beatText, prompt, ...img };
      } catch (err) {
        return {
          beatIndex: i,
          beatText,
          prompt,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  const storyboard: StoryboardFrame[] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { beatIndex: 0, beatText: "", prompt: "", error: "Unknown error" }
  );

  return NextResponse.json({ episodeTitle: episode.title, storyboard });
}
