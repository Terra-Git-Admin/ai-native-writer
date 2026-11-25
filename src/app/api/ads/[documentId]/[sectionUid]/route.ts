import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadAdsCatalog } from "@/lib/ads-catalog-server";
import { isAdsLibraryEnabled } from "@/lib/ads-library-flags";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ documentId: string; sectionUid: string }> }
) {
  if (!isAdsLibraryEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { documentId, sectionUid } = await params;
  const catalog = await loadAdsCatalog();
  const ad = catalog.ads.find((item) => item.documentId === documentId && item.sectionUid === sectionUid);
  if (!ad) return NextResponse.json({ error: "Ad no longer exists" }, { status: 404 });
  return NextResponse.json(ad);
}
