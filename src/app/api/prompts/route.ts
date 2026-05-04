import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { seedPromptsFromCode } from "@/lib/ai/seed-prompts";

// GET /api/prompts — list all prompts (readable by everyone)
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Always seed if the table is empty — guards against stale GCS backups
  // that predate the prompts table, and against the in-memory `seeded` flag
  // surviving a DB wipe mid-run.
  const all = await db.select().from(prompts);
  if (all.length === 0) {
    await seedPromptsFromCode();
    const reseeded = await db.select().from(prompts);
    return NextResponse.json(reseeded);
  }

  return NextResponse.json(all);
}

// PUT /api/prompts — update a prompt (admin only)
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, content } = await req.json();
  if (!id || !content) {
    return NextResponse.json(
      { error: "id and content are required" },
      { status: 400 }
    );
  }

  await db
    .update(prompts)
    .set({ content, updatedAt: new Date() })
    .where(eq(prompts.id, id));

  return NextResponse.json({ ok: true });
}
