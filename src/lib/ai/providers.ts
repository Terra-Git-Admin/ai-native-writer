import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

const OPENAI_FALLBACK_MODEL_ID = "gpt-5.2";

interface AIModel {
  id: string;
  label: string;
  provider: "anthropic" | "google" | "openai";
  thinking?: boolean;
}

export type AIProvider = AIModel["provider"];

export const AI_MODELS: AIModel[] = [
  // OpenAI
  { id: "gpt-5.2", label: "GPT-5.2", provider: "openai" },
  // Google
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "google" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Thinking)", provider: "google", thinking: true },
  // Anthropic
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Thinking)", provider: "anthropic", thinking: true },
  { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", provider: "google" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
  { id: "gemini-2.5-flash-lite-preview-06-17", label: "Gemini 2.5 Flash Lite", provider: "google" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Thinking)", provider: "google", thinking: true },
];

export async function getProviderApiKey(provider: AIProvider): Promise<string | null> {
  const settings = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.id, provider),
  });

  if (!settings) return null;

  try {
    return decrypt(settings.apiKey);
  } catch {
    console.warn("[ai] configured provider key is not decryptable", { provider });
    return null;
  }
}

export async function getAIModel(modelId: string, thinking: boolean = false) {
  // Determine provider from model ID
  const modelDef = AI_MODELS.find((m) => m.id === modelId && m.thinking === thinking)
    || AI_MODELS.find((m) => m.id === modelId);

  if (!modelDef) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const provider = modelDef.provider;

  let apiKey = await getProviderApiKey(provider);
  let resolvedProvider = provider;
  let resolvedModelId = modelId;

  if (!apiKey && provider !== "openai") {
    const fallbackApiKey = await getProviderApiKey("openai");
    if (fallbackApiKey) {
      console.warn("[ai] falling back to OpenAI provider", {
        requestedProvider: provider,
        requestedModelId: modelId,
        fallbackModelId: OPENAI_FALLBACK_MODEL_ID,
      });
      apiKey = fallbackApiKey;
      resolvedProvider = "openai";
      resolvedModelId = OPENAI_FALLBACK_MODEL_ID;
    }
  }

  if (!apiKey) {
    throw new Error(
      `No decryptable API key configured for ${provider}. Ask an admin to add it in Settings.`
    );
  }

  if (resolvedProvider === "anthropic") {
    const anthropic = createAnthropic({ apiKey });
    return anthropic(resolvedModelId);
  } else if (resolvedProvider === "openai") {
    const openai = createOpenAI({ apiKey });
    return openai(resolvedModelId);
  } else {
    const google = createGoogleGenerativeAI({ apiKey });
    return google(resolvedModelId);
  }
}

// Return which providers have keys configured (for the frontend to filter models)
export async function getConfiguredProviders(): Promise<string[]> {
  const all = await db.select({ id: aiSettings.id }).from(aiSettings);
  const configured: string[] = [];

  for (const row of all) {
    if (!["anthropic", "google", "openai"].includes(row.id)) continue;
    const apiKey = await getProviderApiKey(row.id as AIProvider);
    if (apiKey) configured.push(row.id);
  }

  return configured;
}
