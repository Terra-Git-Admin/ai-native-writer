import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function ensurePitchLabOwner(session: Session) {
  const user = session.user;
  await db.insert(users).values({
    id: user.id,
    email: user.email ?? `${user.id}@local.dev`,
    name: user.name ?? "Pitch Lab User",
    image: user.image ?? null,
    role: user.role ?? "user",
    active: true,
    createdAt: new Date(),
  }).onConflictDoNothing();
}
