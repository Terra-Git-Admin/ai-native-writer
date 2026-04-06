import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PUT /api/admin/users/[id] — update role or active status
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Prevent admin from deactivating themselves
  if (id === session.user.id && body.active === false) {
    return NextResponse.json(
      { error: "Cannot deactivate yourself" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (body.role !== undefined && ["admin", "user"].includes(body.role)) {
    updates.role = body.role;
  }
  if (body.active !== undefined) {
    updates.active = body.active;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, id));
  }

  return NextResponse.json({ ok: true });
}
