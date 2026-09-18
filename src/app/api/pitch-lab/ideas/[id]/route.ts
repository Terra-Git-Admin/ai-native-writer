import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pitchIdeas, pitchWorkspaces } from "@/lib/db/schema";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (!["shortlisted", "discarded", "generated"].includes(status)) {
    return NextResponse.json({ error: "Invalid idea action." }, { status: 400 });
  }
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  const [idea] = await db.update(pitchIdeas).set({ status, updatedAt: new Date() })
    .where(and(eq(pitchIdeas.id, id), eq(pitchIdeas.workspaceId, workspace.id)))
    .returning();
  if (!idea) return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  return NextResponse.json({ idea });
}
