import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { adClassifications, adFamilies, adSubtypes } from "@/lib/db/schema";
import { loadAdsCatalog } from "@/lib/ads-catalog-server";
import { isAdsLibraryEnabled } from "@/lib/ads-library-flags";

type AdIdentity = { documentId?: unknown; sectionUid?: unknown };

export async function PATCH(req: Request) {
  if (!isAdsLibraryEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const requested = Array.isArray(body.ads) ? body.ads as AdIdentity[] : [];
  if (requested.length === 0 || requested.length > 200) {
    return NextResponse.json({ error: "Choose between 1 and 200 ads" }, { status: 400 });
  }
  const ads = requested.map((ad) => ({
    documentId: typeof ad.documentId === "string" ? ad.documentId : "",
    sectionUid: typeof ad.sectionUid === "string" ? ad.sectionUid : "",
  }));
  if (ads.some((ad) => !ad.documentId || !ad.sectionUid)) {
    return NextResponse.json({ error: "Every ad needs a documentId and sectionUid" }, { status: 400 });
  }

  const catalog = await loadAdsCatalog();
  const existing = new Set(catalog.ads.map((ad) => `${ad.documentId}:${ad.sectionUid}`));
  const missing = ads.find((ad) => !existing.has(`${ad.documentId}:${ad.sectionUid}`));
  if (missing) return NextResponse.json({ error: "One or more ads no longer exist. Refresh and try again." }, { status: 409 });

  const clear = body.clear === true;
  let familyId = "";
  let subtypeId = "";
  if (!clear) {
    familyId = typeof body.familyId === "string" ? body.familyId : "";
    subtypeId = typeof body.subtypeId === "string" ? body.subtypeId : "";
    const [family, subtype] = await Promise.all([
      db.query.adFamilies.findFirst({ where: eq(adFamilies.id, familyId) }),
      db.query.adSubtypes.findFirst({ where: eq(adSubtypes.id, subtypeId) }),
    ]);
    if (!family || !subtype || subtype.familyId !== family.id) {
      return NextResponse.json({ error: "Choose a valid Creative Family and Subtype" }, { status: 400 });
    }
  }

  db.transaction((tx) => {
    for (const ad of ads) {
      if (clear) {
        tx.delete(adClassifications)
          .where(and(eq(adClassifications.documentId, ad.documentId), eq(adClassifications.sectionUid, ad.sectionUid)))
          .run();
      } else {
        tx.insert(adClassifications)
          .values({ ...ad, familyId, subtypeId, updatedBy: session.user.id, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [adClassifications.documentId, adClassifications.sectionUid],
            set: { familyId, subtypeId, updatedBy: session.user.id, updatedAt: new Date() },
          })
          .run();
      }
    }
  });
  return NextResponse.json({ ok: true, updated: ads.length });
}
