import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadAdsCatalog } from "@/lib/ads-catalog-server";
import { isAdsLibraryEnabled } from "@/lib/ads-library-flags";

export async function GET(req: Request) {
  if (!isAdsLibraryEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
  const familyId = url.searchParams.get("familyId");
  const subtypeId = url.searchParams.get("subtypeId");
  const seriesId = url.searchParams.get("seriesId");
  const status = url.searchParams.get("status");
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const sort = url.searchParams.get("sort") || "updated";
  const catalog = await loadAdsCatalog();

  const baseAds = catalog.ads.filter((ad) => includeArchived || !ad.archived);
  let ads = baseAds.filter((ad) => {
    if (familyId && ad.familyId !== familyId) return false;
    if (subtypeId && ad.subtypeId !== subtypeId) return false;
    if (seriesId && ad.documentId !== seriesId) return false;
    if (status === "unclassified" && ad.familyId) return false;
    if (query) {
      const haystack = [ad.title, ad.seriesTitle, ad.plainText, ad.familyName, ad.subtypeName]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  ads = [...ads].sort((left, right) => {
    if (sort === "ad") return left.title.localeCompare(right.title);
    if (sort === "series") return left.seriesTitle.localeCompare(right.seriesTitle) || left.title.localeCompare(right.title);
    if (sort === "family") return (left.familyName || "~").localeCompare(right.familyName || "~") || (left.subtypeName || "").localeCompare(right.subtypeName || "");
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || left.position - right.position;
  });

  const families = catalog.families.map((family) => {
    const familyAds = baseAds.filter((ad) => ad.familyId === family.id);
    return {
      ...family,
      adCount: familyAds.length,
      seriesCount: new Set(familyAds.map((ad) => ad.documentId)).size,
      subtypes: family.subtypes.map((subtype) => {
        const subtypeAds = familyAds.filter((ad) => ad.subtypeId === subtype.id);
        return {
          ...subtype,
          adCount: subtypeAds.length,
          seriesCount: new Set(subtypeAds.map((ad) => ad.documentId)).size,
        };
      }),
    };
  });
  const series = Array.from(new Map(baseAds.map((ad) => [ad.documentId, {
    id: ad.documentId,
    title: ad.seriesTitle,
    archived: ad.archived,
  }])).values()).sort((a, b) => a.title.localeCompare(b.title));

  return NextResponse.json({
    ads: ads.map((item) => {
      const summary = { ...item };
      delete (summary as Partial<typeof item>).plainText;
      return summary;
    }),
    families,
    series,
    totals: {
      all: baseAds.length,
      filtered: ads.length,
      unclassified: baseAds.filter((ad) => !ad.familyId).length,
    },
    diagnostics: { missingUidCount: catalog.missingUidCount },
  });
}
