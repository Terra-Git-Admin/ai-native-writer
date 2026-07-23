// Standalone tagged-text → Tiptap JSON string converter.
//
// Input:  tagged string with structural tags [H1]/[H2]/[H3]/[P]/[UL]/[OL],
//         already stripped of the AI draft-signal prefix (0\n or 1\n).
// Output: Tiptap doc JSON string, suitable for storing in tabs.content or
//         feeding to editor.commands.setContent(JSON.parse(...)).
//
// Reuses parseTaggedLines from tagged-parser.ts — do not duplicate that logic.
// This lives in lib/ai/ (not in the editor component tree) so PipelinePlayground
// can import it without pulling in React/editor dependencies.

import { parseTaggedLines, taggedTextToTiptapDoc } from "@/lib/editor/tagged-parser";

export { parseTaggedLines };

// Convert a tagged string to a Tiptap doc JSON string.
// Returns the JSON string, not a parsed object — callers can JSON.parse() if needed.
export function taggedToTiptapJson(tagged: string): string {
  if (!tagged.trim()) {
    return JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
  }
  const doc = taggedTextToTiptapDoc(tagged);
  return JSON.stringify(doc);
}
