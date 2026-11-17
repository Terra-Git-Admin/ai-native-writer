import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { folders } from "@/lib/db/schema";
import { validateFolderName } from "@/lib/document-organization";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(folders)
    .where(eq(folders.ownerId, session.user.id))
    .orderBy(asc(folders.normalizedName));
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const validation = validateFolderName(body.name);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const { name, normalizedName } = validation;
  const existing = await db.query.folders.findFirst({
    where: (folder, { and, eq }) =>
      and(
        eq(folder.ownerId, session.user.id),
        eq(folder.normalizedName, normalizedName)
      ),
  });
  if (existing) {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }

  const now = new Date();
  const folder = {
    id: nanoid(12),
    ownerId: session.user.id,
    name,
    normalizedName,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(folders).values(folder);
  return NextResponse.json(folder, { status: 201 });
}
