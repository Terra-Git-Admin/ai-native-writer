import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProviderApiKey } from "@/lib/ai/providers";

const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
const GEMINI_TTS_VOICE = "Kore";
const MAX_TEXT_CHARS = 3800;

function wavFromPcmBase64(base64Pcm: string, sampleRate = 24000): string {
  const pcm = Buffer.from(base64Pcm, "base64");
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]).toString("base64");
}

function sampleRateFromMime(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24000;
}

function prepareSpeechText(rawText: string): { text: string; style: string } {
  const bracketedDirections = Array.from(rawText.matchAll(/\[([^\]]{2,80})\]/g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 12);
  const text = rawText
    .replace(/\[[^\]]{1,120}\]\s*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const style = [
    "Expressive microdrama table read with natural pacing, emotional contrast, and engaged delivery.",
    "Keep narration clear and avoid robotic announcer tone.",
    bracketedDirections.length
      ? `Use these source cues for performance only: ${bracketedDirections.join(", ")}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return { text, style };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const rawText = typeof body.text === "string" ? body.text.trim() : "";

  if (!rawText) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (rawText.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `text must be ${MAX_TEXT_CHARS} characters or fewer` },
      { status: 400 }
    );
  }

  const speech = prepareSpeechText(rawText);
  if (!speech.text) {
    return NextResponse.json(
      { error: "text has no speakable content" },
      { status: 400 }
    );
  }

  const apiKey = await getProviderApiKey("google");
  if (!apiKey) {
    return NextResponse.json(
      { error: "No decryptable Google API key configured." },
      { status: 400 }
    );
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: speech.text,
                speech_metadata: { style: speech.style },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              voice: GEMINI_TTS_VOICE,
            },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "Gemini TTS failed", detail: detail.slice(0, 1000) },
      { status: 502 }
    );
  }

  const data = await res.json();
  const audioPart = data?.candidates?.[0]?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) =>
      part.inlineData?.data
  );
  const audioBase64 = audioPart?.inlineData?.data;
  const mimeType = audioPart?.inlineData?.mimeType as string | undefined;

  if (!audioBase64) {
    return NextResponse.json(
      { error: "Gemini returned no audio" },
      { status: 502 }
    );
  }

  if (mimeType?.includes("wav")) {
    return NextResponse.json({
      audioDataUrl: `data:${mimeType};base64,${audioBase64}`,
      mimeType,
    });
  }

  const wavBase64 = wavFromPcmBase64(audioBase64, sampleRateFromMime(mimeType));
  return NextResponse.json({
    audioDataUrl: `data:audio/wav;base64,${wavBase64}`,
    mimeType: "audio/wav",
  });
}
