import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  EDIT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  FEEDBACK_SYSTEM_PROMPT,
  FORMAT_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  DOCUMENT_STYLE_GUIDE,
  CANONICAL_REF_EPISODE_FORMAT,
  EPISODE_PLOTS_FORMAT,
  MICRODRAMA_SCRIPTWRITER_KNOWLEDGE,
  MICRODRAMA_ADAPTATION_KNOWLEDGE,
  MICRODRAMA_EPISODE_TOOLKIT,
  MICRODRAMA_STORY_ENGINE,
  MICRODRAMA_SERIES_ENGINE,
  MICRODRAMA_CHARACTER_ENGINE,
  MICRODRAMA_GENRE_CONTRACT,
  PLOT_INTEGRITY_AUDIT,
  BEAT_OPTION_FRAMEWORK,
  EPISODE_PLOT_ADAPTATION_WORKFLOW,
} from "@/lib/ai/prompts";

let seeded = false;

const DEFAULTS = [
  { id: "style_guide", label: "Style Guide", content: DOCUMENT_STYLE_GUIDE },
  { id: "edit", label: "Select & Edit", content: EDIT_SYSTEM_PROMPT },
  { id: "draft", label: "Series Creation (Blank Doc)", content: DRAFT_SYSTEM_PROMPT },
  { id: "feedback", label: "Full-Doc Feedback", content: FEEDBACK_SYSTEM_PROMPT },
  { id: "format", label: "Format Document", content: FORMAT_SYSTEM_PROMPT },
  { id: "chat", label: "Chat Mode", content: CHAT_SYSTEM_PROMPT },
  { id: "ref_episode_format", label: "Reference Episode Format Spec", content: CANONICAL_REF_EPISODE_FORMAT },
  { id: "episode_plots_format", label: "Episode Plots Format Spec", content: EPISODE_PLOTS_FORMAT },
  { id: "scriptwriter_knowledge", label: "Microdrama Craft Knowledge", content: MICRODRAMA_SCRIPTWRITER_KNOWLEDGE },
  { id: "adaptation_knowledge", label: "Microdrama Adaptation Knowledge (Arc & Compression)", content: MICRODRAMA_ADAPTATION_KNOWLEDGE },
  { id: "episode_toolkit", label: "Microdrama Episode Toolkit (Beat Economy, 4-Part Shape, Value Shift, Beat Types, Chain Logic)", content: MICRODRAMA_EPISODE_TOOLKIT },
  { id: "story_engine", label: "Microdrama Story Engine (Forbidden Question, Relationship Heartbeat, Emotional Temperature, A/B/C Beat Counts, Information Drip)", content: MICRODRAMA_STORY_ENGINE },
  { id: "series_engine", label: "Microdrama Series Engine (Series Spine, Escalation Ladders, Character Arc, Villain Curve, Session Structure)", content: MICRODRAMA_SERIES_ENGINE },
  { id: "plot_integrity_audit", label: "Plot Integrity Audit (Why Chain + Scene Logic + Character Introduction)", content: PLOT_INTEGRITY_AUDIT },
  { id: "beat_option_framework", label: "Beat Option Framework (Character × Location × Topic × Mode, 3-option generation)", content: BEAT_OPTION_FRAMEWORK },
  { id: "adaptation_workflow", label: "Episode Plot Adaptation Workflow", content: EPISODE_PLOT_ADAPTATION_WORKFLOW },
  { id: "character_engine", label: "Microdrama Character Engine (Engine / Wall / Witness / Nuke)", content: MICRODRAMA_CHARACTER_ENGINE },
  { id: "genre_contract", label: "Microdrama Genre Contract (Shock / Hurt / Release by Genre)", content: MICRODRAMA_GENRE_CONTRACT },
];

// GET /api/prompts — list all prompts (readable by everyone)
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Upsert defaults from code once per server process.
  // This ensures code changes propagate on deploy/restart,
  // but admin edits persist within the same server session.
  if (!seeded) {
    const now = new Date();
    for (const d of DEFAULTS) {
      const existing = await db.query.prompts.findFirst({
        where: eq(prompts.id, d.id),
      });
      if (existing) {
        await db
          .update(prompts)
          .set({ content: d.content, label: d.label, updatedAt: now })
          .where(eq(prompts.id, d.id));
      } else {
        await db.insert(prompts).values({ ...d, updatedAt: now });
      }
    }
    seeded = true;
  }

  const all = await db.select().from(prompts);
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
