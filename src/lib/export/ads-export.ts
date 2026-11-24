import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { handoffExports, tabs } from "@/lib/db/schema";
import { tiptapJsonToTagged } from "@/lib/ai/context-engine";

export interface AdsExport {
  exportId: string;
  documentId: string;
  documentType: "ads";
  exportedAt: string;
  version: 1;
  series: { title: string };
  ads: { contentJson: string | null; contentTagged: string; updatedAt: string | null };
}

export async function buildAdsExport(documentId: string, documentTitle: string, userId: string, baseUrl: string) {
  const allTabs = await db.query.tabs.findMany({ where: eq(tabs.documentId, documentId), orderBy: [asc(tabs.position)] });
  const adsTab = allTabs.find((tab) => tab.type === "ads");
  const now = new Date();
  const exportId = nanoid();
  const payload: AdsExport = {
    exportId,
    documentId,
    documentType: "ads",
    exportedAt: now.toISOString(),
    version: 1,
    series: { title: documentTitle },
    ads: {
      contentJson: adsTab?.content ?? null,
      contentTagged: tiptapJsonToTagged(adsTab?.content ?? null),
      updatedAt: adsTab?.updatedAt.toISOString() ?? null,
    },
  };
  await db.insert(handoffExports).values({
    id: exportId,
    documentId,
    createdBy: userId,
    exportJson: JSON.stringify(payload),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
  });
  return { exportId, exportUrl: `${baseUrl}/api/export/${exportId}`, export: payload };
}
