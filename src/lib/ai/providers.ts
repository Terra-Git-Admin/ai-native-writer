import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { db } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

interface AIModel {
  id: string;
  label: string;
  provider: "anthropic" | "google";
  thinking?: boolean;
}

export const AI_MODELS: AIModel[] = [
  // Anthropic
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Thinking)", provider: "anthropic", thinking: true },
  // Google
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
  { id: "gemini-2.5-flash-lite-preview-06-17", label: "Gemini 2.5 Flash Lite", provider: "google" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Thinking)", provider: "google", thinking: true },
];

export async function getAIModel(modelId: string, thinking: boolean = false) {
  // Determine provider from model ID
  const modelDef = AI_MODELS.find((m) => m.id === modelId && m.thinking === thinking)
    || AI_MODELS.find((m) => m.id === modelId);

  if (!modelDef) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const provider = modelDef.provider;

  // Fetch the key for this provider
  const settings = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.id, provider),
  });

  if (!settings) {
    throw new Error(
      `No API key configured for ${provider}. Ask an admin to add it in Settings.`
    );
  }

  const apiKey = decrypt(settings.apiKey);

  if (provider === "anthropic") {
    const anthropic = createAnthropic({ apiKey });
    return anthropic(modelId);
  } else {
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }
}

// Return which providers have keys configured (for the frontend to filter models)
export async function getConfiguredProviders(): Promise<string[]> {
  const all = await db.select({ id: aiSettings.id }).from(aiSettings);
  return all.map((r) => r.id);
}
