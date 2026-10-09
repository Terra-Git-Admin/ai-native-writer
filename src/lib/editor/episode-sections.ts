export interface EpisodeSection {
  index: number;
  label: string;
  text: string;
  contentHash: string;
}

interface TiptapNode {
  type?: string;
  attrs?: { level?: number };
  content?: TiptapNode[];
  text?: string;
}

function textOf(node: TiptapNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function isEpisodeHeading(node: TiptapNode, text: string): boolean {
  return node.type === "heading" && /^episode\s*\d\b/i.test(text.trim());
}

export function extractEpisodeSections(contentJson: string | null): EpisodeSection[] {
  if (!contentJson) return [];

  let doc: TiptapNode;
  try {
    doc = JSON.parse(contentJson) as TiptapNode;
  } catch {
    return [];
  }

  const episodes: EpisodeSection[] = [];
  let label = "";
  let lines: string[] = [];

  const flush = () => {
    if (!label) return;
    const text = lines.join("\n").trim();
    episodes.push({
      index: episodes.length,
      label,
      text,
      contentHash: hashText(text),
    });
  };

  for (const node of doc.content ?? []) {
    const text = textOf(node).trim();
    if (!text) continue;

    if (isEpisodeHeading(node, text)) {
      flush();
      label = text;
      lines = [text];
      continue;
    }

    if (label) lines.push(text);
  }

  flush();
  return episodes;
}
