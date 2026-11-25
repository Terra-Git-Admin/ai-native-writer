import { nanoid } from "nanoid";

export type AdsTiptapNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: AdsTiptapNode[];
  text?: string;
};

export type ExtractedAd = {
  sectionUid: string | null;
  title: string;
  position: number;
  contentJson: string;
  plainText: string;
  excerpt: string;
};

type AdsDocument = AdsTiptapNode & { type: "doc" };

const AD_HEADING = /^Ad:\s*(.+)$/i;

function parseDocument(contentJson: string | null): AdsDocument | null {
  if (!contentJson) return null;
  try {
    const parsed = JSON.parse(contentJson) as AdsDocument;
    return parsed?.type === "doc" ? parsed : null;
  } catch {
    return null;
  }
}

function nodeText(node: AdsTiptapNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function adTitle(node: AdsTiptapNode): string | null {
  if (node.type !== "heading" || node.attrs?.level !== 3) return null;
  return nodeText(node).trim().match(AD_HEADING)?.[1]?.trim() || null;
}

function sectionPlainText(nodes: AdsTiptapNode[]): string {
  return nodes
    .map((node) => nodeText(node).trim())
    .filter(Boolean)
    .join("\n");
}

export function ensureAdSectionUids(contentJson: string | null): {
  contentJson: string | null;
  changed: boolean;
  adsSeen: number;
} {
  const doc = parseDocument(contentJson);
  if (!doc?.content) return { contentJson, changed: false, adsSeen: 0 };

  const seen = new Set<string>();
  let changed = false;
  let adsSeen = 0;
  for (const node of doc.content) {
    if (!adTitle(node)) continue;
    adsSeen += 1;
    const existing = typeof node.attrs?.anwSectionUid === "string"
      ? node.attrs.anwSectionUid.trim()
      : "";
    if (!existing || seen.has(existing)) {
      node.attrs = { ...(node.attrs ?? {}), anwSectionUid: `ad_${nanoid(14)}` };
      seen.add(String(node.attrs.anwSectionUid));
      changed = true;
    } else {
      seen.add(existing);
    }
  }
  return {
    contentJson: changed ? JSON.stringify(doc) : contentJson,
    changed,
    adsSeen,
  };
}

export function extractAds(contentJson: string | null): ExtractedAd[] {
  const doc = parseDocument(contentJson);
  if (!doc?.content) return [];

  const ads: ExtractedAd[] = [];
  let current: { title: string; heading: AdsTiptapNode; nodes: AdsTiptapNode[] } | null = null;
  const flush = () => {
    if (!current) return;
    const plainText = sectionPlainText(current.nodes);
    const sectionUid = typeof current.heading.attrs?.anwSectionUid === "string"
      ? current.heading.attrs.anwSectionUid
      : null;
    ads.push({
      sectionUid,
      title: current.title,
      position: ads.length,
      contentJson: JSON.stringify({ type: "doc", content: current.nodes }),
      plainText,
      excerpt: plainText.replace(/^Ad:\s*[^\n]+\n?/i, "").slice(0, 220),
    });
    current = null;
  };

  for (const node of doc.content) {
    const title = adTitle(node);
    if (title) {
      flush();
      current = { title, heading: node, nodes: [node] };
    } else if (current) {
      current.nodes.push(node);
    }
  }
  flush();
  return ads;
}

export function validateTaxonomyName(value: unknown):
  | { ok: true; name: string; normalizedName: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Name is required" };
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Name must be between 2 and 80 characters" };
  }
  return { ok: true, name, normalizedName: name.toLocaleLowerCase() };
}

export function cleanTaxonomyDescription(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}
