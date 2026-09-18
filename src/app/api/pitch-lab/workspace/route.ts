import { eq, asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pitchIdeas, pitchSources, pitchWorkspaces } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspace = await db.query.pitchWorkspaces.findFirst({ where: eq(pitchWorkspaces.ownerId, session.user.id) });
  if (!workspace) return NextResponse.json({ workspace: null, ideas: [], sources: [] });
  const [ideas, sources] = await Promise.all([
    db.select().from(pitchIdeas).where(eq(pitchIdeas.workspaceId, workspace.id)).orderBy(asc(pitchIdeas.position)),
    db.select().from(pitchSources).where(eq(pitchSources.workspaceId, workspace.id)),
  ]);
  return NextResponse.json({ workspace, ideas, sources });
}
