import { NextResponse } from "next/server";
import { isPitchLabEnabled } from "@/lib/pitch-lab-flags";

type PitchLabSession = {
  user?: {
    role?: string | null;
  } | null;
} | null;

export function requirePitchLabAdmin(session: PitchLabSession) {
  if (!isPitchLabEnabled()) {
    return NextResponse.json({ error: "Pitch Lab is not enabled in this environment." }, { status: 404 });
  }
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Pitch Lab is currently available to admins only while testing." }, { status: 403 });
  }
  return null;
}
