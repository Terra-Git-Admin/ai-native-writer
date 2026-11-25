import { NextResponse } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { adClassifications, adFamilies, adSubtypes } from "@/lib/db/schema";
import { cleanTaxonomyDescription, validateTaxonomyName } from "@/lib/ads-catalog";
import { isAdsLibraryEnabled } from "@/lib/ads-library-flags";

async function requireAdmin() {
  if (!isAdsLibraryEnabled()) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

async function hierarchy() {
  const [families, subtypes] = await Promise.all([
    db.select().from(adFamilies).orderBy(asc(adFamilies.position), asc(adFamilies.name)),
    db.select().from(adSubtypes).orderBy(asc(adSubtypes.position), asc(adSubtypes.name)),
  ]);
  return families.map((family) => ({
    ...family,
    subtypes: subtypes.filter((subtype) => subtype.familyId === family.id),
  }));
}

export async function GET() {
  const access = await requireAdmin();
  if (access.error) return access.error;
  return NextResponse.json(await hierarchy());
}

export async function POST(req: Request) {
  const access = await requireAdmin();
  if (access.error) return access.error;
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "subtype" ? "subtype" : "family";
  const validation = validateTaxonomyName(body.name);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const description = cleanTaxonomyDescription(body.description);
  const now = new Date();

  try {
    if (kind === "family") {
      const rows = await db.select().from(adFamilies);
      const created = { id: nanoid(12), ...validation, description, position: rows.length, createdAt: now, updatedAt: now };
      await db.insert(adFamilies).values(created);
      return NextResponse.json(created, { status: 201 });
    }
    const familyId = typeof body.familyId === "string" ? body.familyId : "";
    const family = await db.query.adFamilies.findFirst({ where: eq(adFamilies.id, familyId) });
    if (!family) return NextResponse.json({ error: "Creative Family not found" }, { status: 404 });
    const rows = await db.select().from(adSubtypes).where(eq(adSubtypes.familyId, familyId));
    const created = { id: nanoid(12), familyId, ...validation, description, position: rows.length, createdAt: now, updatedAt: now };
    await db.insert(adSubtypes).values(created);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (String(error).toLocaleLowerCase().includes("unique")) {
      return NextResponse.json({ error: `A ${kind} with that name already exists` }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(req: Request) {
  const access = await requireAdmin();
  if (access.error) return access.error;
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "subtype" ? "subtype" : "family";
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Taxonomy id is required" }, { status: 400 });
  const table = kind === "family" ? adFamilies : adSubtypes;
  const existing = kind === "family"
    ? await db.query.adFamilies.findFirst({ where: eq(adFamilies.id, id) })
    : await db.query.adSubtypes.findFirst({ where: eq(adSubtypes.id, id) });
  if (!existing) return NextResponse.json({ error: `${kind} not found` }, { status: 404 });

  if (body.move === "up" || body.move === "down") {
    const siblings = kind === "family"
      ? await db.select().from(adFamilies).orderBy(asc(adFamilies.position), asc(adFamilies.name))
      : await db.select().from(adSubtypes).where(eq(adSubtypes.familyId, (existing as typeof adSubtypes.$inferSelect).familyId)).orderBy(asc(adSubtypes.position), asc(adSubtypes.name));
    const index = siblings.findIndex((item) => item.id === id);
    const targetIndex = body.move === "up" ? index - 1 : index + 1;
    if (index >= 0 && targetIndex >= 0 && targetIndex < siblings.length) {
      const neighbor = siblings[targetIndex];
      db.transaction((tx) => {
        tx.update(table).set({ position: neighbor.position, updatedAt: new Date() }).where(eq(table.id, id)).run();
        tx.update(table).set({ position: existing.position, updatedAt: new Date() }).where(eq(table.id, neighbor.id)).run();
      });
    }
    return NextResponse.json({ ok: true });
  }

  const validation = validateTaxonomyName(body.name);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  try {
    await db.update(table).set({
      name: validation.name,
      normalizedName: validation.normalizedName,
      description: cleanTaxonomyDescription(body.description),
      updatedAt: new Date(),
    }).where(eq(table.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (String(error).toLocaleLowerCase().includes("unique")) {
      return NextResponse.json({ error: `A ${kind} with that name already exists` }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(req: Request) {
  const access = await requireAdmin();
  if (access.error) return access.error;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "subtype" ? "subtype" : "family";
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Taxonomy id is required" }, { status: 400 });

  if (kind === "family") {
    const [subtypeCount, assignmentCount] = await Promise.all([
      db.select({ value: count() }).from(adSubtypes).where(eq(adSubtypes.familyId, id)),
      db.select({ value: count() }).from(adClassifications).where(eq(adClassifications.familyId, id)),
    ]);
    if ((subtypeCount[0]?.value ?? 0) > 0 || (assignmentCount[0]?.value ?? 0) > 0) {
      return NextResponse.json({ error: "Remove this Family's Subtypes and assignments first" }, { status: 409 });
    }
    await db.delete(adFamilies).where(eq(adFamilies.id, id));
  } else {
    const assignmentCount = await db.select({ value: count() }).from(adClassifications).where(eq(adClassifications.subtypeId, id));
    if ((assignmentCount[0]?.value ?? 0) > 0) {
      return NextResponse.json({ error: "Reassign or clear this Subtype's ads first" }, { status: 409 });
    }
    await db.delete(adSubtypes).where(eq(adSubtypes.id, id));
  }
  return NextResponse.json({ ok: true });
}
