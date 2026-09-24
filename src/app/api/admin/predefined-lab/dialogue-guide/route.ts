import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import {
  DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE,
  PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID,
  getActivePredefinedLabDialogueGuide,
} from "@/lib/ai/predefined-lab-dialogue-guide";

const LABEL = "Predefined Lab Dialogue Quality Guide";

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID),
  });

  return NextResponse.json({
    content: row?.content ?? (await getActivePredefinedLabDialogueGuide()),
    source: row?.content ? "db" : "default",
    updatedAt: row?.updatedAt ?? null,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "Dialogue guide cannot be empty." }, { status: 400 });
  }

  const now = new Date();
  const existing = await db.query.prompts.findFirst({
    where: eq(prompts.id, PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID),
  });

  if (existing) {
    await db
      .update(prompts)
      .set({ label: LABEL, content, updatedAt: now })
      .where(eq(prompts.id, PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID));
  } else {
    await db.insert(prompts).values({
      id: PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID,
      label: LABEL,
      content: content || DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true, updatedAt: now });
}
