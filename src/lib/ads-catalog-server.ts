import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adClassifications,
  adFamilies,
  adSubtypes,
  documents,
  tabs,
  users,
} from "@/lib/db/schema";
import { extractAds } from "@/lib/ads-catalog";

export type AdCatalogEntry = {
  documentId: string;
  sectionUid: string;
  tabId: string;
  title: string;
  excerpt: string;
  plainText: string;
  position: number;
  seriesTitle: string;
  ownerName: string | null;
  archived: boolean;
  updatedAt: string;
  familyId: string | null;
  familyName: string | null;
  subtypeId: string | null;
  subtypeName: string | null;
};

export type AdTaxonomyFamily = {
  id: string;
  name: string;
  description: string;
  position: number;
  adCount: number;
  seriesCount: number;
  subtypes: Array<{
    id: string;
    name: string;
    description: string;
    position: number;
    adCount: number;
    seriesCount: number;
  }>;
};

function iso(value: Date | string | number): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function loadAdsCatalog() {
  const [sources, classifications, familyRows, subtypeRows] = await Promise.all([
    db
      .select({
        documentId: documents.id,
        seriesTitle: documents.title,
        archivedAt: documents.archivedAt,
        ownerName: users.name,
        tabId: tabs.id,
        content: tabs.content,
        updatedAt: tabs.updatedAt,
      })
      .from(tabs)
      .innerJoin(documents, eq(tabs.documentId, documents.id))
      .leftJoin(users, eq(documents.ownerId, users.id))
      .where(eq(tabs.type, "ads")),
    db.select().from(adClassifications),
    db.select().from(adFamilies).orderBy(asc(adFamilies.position), asc(adFamilies.name)),
    db.select().from(adSubtypes).orderBy(asc(adSubtypes.position), asc(adSubtypes.name)),
  ]);

  const familyMap = new Map(familyRows.map((row) => [row.id, row]));
  const subtypeMap = new Map(subtypeRows.map((row) => [row.id, row]));
  const classificationMap = new Map(
    classifications.map((row) => [`${row.documentId}:${row.sectionUid}`, row])
  );
  const ads: AdCatalogEntry[] = [];
  let missingUidCount = 0;

  for (const source of sources) {
    for (const ad of extractAds(source.content)) {
      if (!ad.sectionUid) {
        missingUidCount += 1;
        continue;
      }
      const classification = classificationMap.get(`${source.documentId}:${ad.sectionUid}`);
      const family = classification ? familyMap.get(classification.familyId) : null;
      const subtype = classification ? subtypeMap.get(classification.subtypeId) : null;
      ads.push({
        documentId: source.documentId,
        sectionUid: ad.sectionUid,
        tabId: source.tabId,
        title: ad.title,
        excerpt: ad.excerpt,
        plainText: ad.plainText,
        position: ad.position,
        seriesTitle: source.seriesTitle,
        ownerName: source.ownerName,
        archived: Boolean(source.archivedAt),
        updatedAt: iso(source.updatedAt),
        familyId: family?.id ?? null,
        familyName: family?.name ?? null,
        subtypeId: subtype?.id ?? null,
        subtypeName: subtype?.name ?? null,
      });
    }
  }

  const families: AdTaxonomyFamily[] = familyRows.map((family) => {
    const familyAds = ads.filter((ad) => ad.familyId === family.id);
    return {
      id: family.id,
      name: family.name,
      description: family.description,
      position: family.position,
      adCount: familyAds.length,
      seriesCount: new Set(familyAds.map((ad) => ad.documentId)).size,
      subtypes: subtypeRows
        .filter((subtype) => subtype.familyId === family.id)
        .map((subtype) => {
          const subtypeAds = familyAds.filter((ad) => ad.subtypeId === subtype.id);
          return {
            id: subtype.id,
            name: subtype.name,
            description: subtype.description,
            position: subtype.position,
            adCount: subtypeAds.length,
            seriesCount: new Set(subtypeAds.map((ad) => ad.documentId)).size,
          };
        }),
    };
  });

  return { ads, families, missingUidCount };
}
