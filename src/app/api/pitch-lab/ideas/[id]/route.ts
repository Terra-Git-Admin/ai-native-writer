import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pitchIdeas, pitchWorkspaces } from "@/lib/db/schema";
import { cleanPitchLabTitle, isValidPitchLabTitle } from "@/lib/ai/pitch-lab-prompts";
import { getPitchLabContentState } from "@/lib/ai/pitch-lab-content-contract";
import { requirePitchLabAccess } from "@/lib/pitch-lab-access";
import { parsePitchIdeaEnvelope, serializePitchIdeaEnvelope } from "@/lib/pitch-lab-idea-envelope";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const accessError = requirePitchLabAccess(session);
  if (accessError) return accessError;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;
  const title = typeof body?.title === "string" ? cleanPitchLabTitle(body.title) : "";
  if (!["premise", "shortlisted", "discarded", "generated"].includes(status)) {
    return NextResponse.json({ error: "Invalid idea action." }, { status: 400 });
  }
  if (title && !isValidPitchLabTitle(title)) {
    return NextResponse.json({ error: "Use a title of one or two words." }, { status: 400 });
  }
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  const existing = await db.query.pitchIdeas.findFirst({ where: and(eq(pitchIdeas.id, id), eq(pitchIdeas.workspaceId, workspace.id)) });
  if (!existing) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  const now = new Date();
  const envelope = parsePitchIdeaEnvelope(existing.ideaText);
  const state = getPitchLabContentState(existing.status, existing.ideaText);
  if (status === "shortlisted" && (existing.status !== "generated" || state.contentKind !== "pilot_option" || !state.isValid)) {
    return NextResponse.json({ error: "Only valid Pilot Options can be moved to Shortlist." }, { status: 400 });
  }
  if (status === "premise" && state.contentKind !== "idea_seed") {
    return NextResponse.json({ error: "Only valid Ideas can be restored to Ideas." }, { status: 400 });
  }
  if (status === "generated" && state.contentKind !== "pilot_option") {
    return NextResponse.json({ error: "Only valid Pilot Options can be restored to Pilot Options." }, { status: 400 });
  }
  const ideaText = status === "shortlisted" && !envelope.shortlistedAt
    ? serializePitchIdeaEnvelope({ ...envelope, shortlistedAt: now.toISOString() })
    : existing.ideaText;
  const [idea] = await db.update(pitchIdeas).set({ status, ideaText, ...(title ? { title } : {}), updatedAt: now })
    .where(and(eq(pitchIdeas.id, id), eq(pitchIdeas.workspaceId, workspace.id)))
    .returning();
  if (!idea) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  return NextResponse.json({ idea });
}
