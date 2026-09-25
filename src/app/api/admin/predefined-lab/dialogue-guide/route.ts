import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import {
  DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE,
  DEFAULT_PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK,
  PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID,
  PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK_PROMPT_ID,
  getActivePredefinedLabDialogueGuide,
  getActivePredefinedLabDialogueReferencePack,
} from "@/lib/ai/predefined-lab-dialogue-guide";

const LABEL = "Predefined Lab Dialogue Quality Guide";
const REFERENCE_PACK_LABEL = "Predefined Lab Dialogue Reference Pack";

function resolveTarget(req: Request) {
  const url = new URL(req.url);
  const isReferencePack = url.searchParams.get("type") === "reference_pack";
  return {
    id: isReferencePack ? PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK_PROMPT_ID : PREDEFINED_LAB_DIALOGUE_GUIDE_PROMPT_ID,
    label: isReferencePack ? REFERENCE_PACK_LABEL : LABEL,
    defaultContent: isReferencePack ? DEFAULT_PREDEFINED_LAB_DIALOGUE_REFERENCE_PACK : DEFAULT_PREDEFINED_LAB_DIALOGUE_GUIDE,
    emptyError: isReferencePack ? "Dialogue reference pack cannot be empty." : "Dialogue guide cannot be empty.",
    loadDefault: isReferencePack
      ? getActivePredefinedLabDialogueReferencePack
      : getActivePredefinedLabDialogueGuide,
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = resolveTarget(req);
  const row = await db.query.prompts.findFirst({
    where: eq(prompts.id, target.id),
  });

  return NextResponse.json({
    content: row?.content ?? (await target.loadDefault()),
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
  const target = resolveTarget(req);
  if (!content) {
    return NextResponse.json({ error: target.emptyError }, { status: 400 });
  }

  const now = new Date();
  const existing = await db.query.prompts.findFirst({
    where: eq(prompts.id, target.id),
  });

  if (existing) {
    await db
      .update(prompts)
      .set({ label: target.label, content, updatedAt: now })
      .where(eq(prompts.id, target.id));
  } else {
    await db.insert(prompts).values({
      id: target.id,
      label: target.label,
      content: content || target.defaultContent,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true, updatedAt: now });
}
