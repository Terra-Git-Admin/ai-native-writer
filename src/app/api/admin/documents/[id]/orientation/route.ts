import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { isDocumentOrientation } from "@/lib/document-orientation";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!isDocumentOrientation(body?.orientation)) {
    return NextResponse.json({ error: "orientation must be portrait or landscape" }, { status: 400 });
  }
  const existing = await db.query.documents.findFirst({ where: eq(documents.id, id) });
  if (!existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  await db.update(documents).set({ orientation: body.orientation, updatedAt: new Date() }).where(eq(documents.id, id));
  return NextResponse.json({ ok: true, orientation: body.orientation });
}
