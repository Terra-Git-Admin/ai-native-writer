import { streamText } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAIModel } from "@/lib/ai/providers";
import {
  EDIT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  FEEDBACK_SYSTEM_PROMPT,
  FORMAT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";

type Mode = "edit" | "draft" | "feedback" | "format" | "chat";

const FALLBACK_PROMPTS: Record<Mode, string> = {
  edit: EDIT_SYSTEM_PROMPT,
  draft: DRAFT_SYSTEM_PROMPT,
  feedback: FEEDBACK_SYSTEM_PROMPT,
  format: FORMAT_SYSTEM_PROMPT,
  chat: CHAT_SYSTEM_PROMPT,
};

async function getSystemPrompt(mode: Mode): Promise<string> {
  // Try to load from DB (admin-editable)
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, mode),
  });
  return row?.content || FALLBACK_PROMPTS[mode];
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const body = await req.json();
  const {
    messages,
    mode = "edit",
    modelId,
    thinking,
  } = body as {
    messages: { role: "user" | "assistant"; content: string }[];
    mode?: Mode;
    modelId?: string;
    thinking?: boolean;
  };

  if (!messages || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages array is required" }),
      { status: 400 }
    );
  }

  const systemPrompt = await getSystemPrompt(mode);

  try {
    const model = await getAIModel(
      modelId || "claude-sonnet-4-20250514",
      thinking
    );

    const streamOptions: Parameters<typeof streamText>[0] = {
      model,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    };

    if (thinking) {
      streamOptions.providerOptions = {
        anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
        google: { thinkingConfig: { thinkingBudget: 10000 } },
      };
    }

    const result = streamText(streamOptions);
    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
