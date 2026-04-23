"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import CharacterCount from "@tiptap/extension-character-count";
import FontFamily from "@tiptap/extension-font-family";
import { TextStyle, FontSize, Color } from "@tiptap/extension-text-style";
import { CommentMark } from "@/extensions/comment-mark";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import EditorToolbar from "./EditorToolbar";
import type { EditorState } from "@tiptap/pm/state";
// Used by the poll to decide whether to auto-apply server content (comment-mark
// sync from a reviewer is safe) or surface a conflict banner (structural edit
// from another tab). Implementation lives in src/lib/commentMarks.ts so the
// server seatbelt uses the same comparison.
import { isCommentMarkOnlyDiff, isNormalisedEqual } from "@/lib/commentMarks";
import { clientTrace } from "@/lib/clientTrace";

export type TaggedBlock = {
  line: string; // full tagged string e.g. "[OL] Flutter app in V2..."
  from: number; // document position start
  to: number;   // document position end
};

export interface HeadingItem {
  level: 1 | 2 | 3;
  text: string;
  pos: number; // ProseMirror doc position of the heading node
}

// Walk the selection and extract each block as a tagged line, recording positions.
function extractTaggedBlocks(state: EditorState, from: number, to: number): TaggedBlock[] {
  const blocks: TaggedBlock[] = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === "listItem") {
      const tag = parent?.type.name === "orderedList" ? "[OL]" : "[UL]";
      const text = node.textContent.trim();
      if (text) {
        blocks.push({
          line: `${tag} ${text}`,
          from: pos,
          to: pos + node.nodeSize,
        });
      }
      return false;
    }
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      if (text) {
        blocks.push({
          line: `[H${node.attrs.level}] ${text}`,
          from: pos,
          to: pos + node.nodeSize,
        });
      }
      return false;
    }
    if (node.type.name === "paragraph" && parent?.type.name !== "listItem") {
      const text = node.textContent.trim();
      if (text) {
        blocks.push({
          line: `[P] ${text}`,
          from: pos,
          to: pos + node.nodeSize,
        });
      }
      return false;
    }
    return true;
  });
  return blocks;
}

// Parse the AI's tagged output into Tiptap JSON nodes.
function parseTaggedLines(lines: string[]): object[] {
  const nodes: object[] = [];
  let listType: "orderedList" | "bulletList" | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (listType && listItems.length > 0) {
      nodes.push({
        type: listType,
        content: listItems.map((t) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
        })),
      });
      listItems = [];
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const ol = line.match(/^\[OL\]\s*(.+)/i);
    const ul = line.match(/^\[UL\]\s*(.+)/i);
    const h = line.match(/^\[H([1-6])\]\s*(.+)/i);
    const p = line.match(/^\[P\]\s*(.+)/i);

    if (ol) {
      if (listType !== "orderedList") flushList();
      listType = "orderedList";
      listItems.push(ol[1]);
    } else if (ul) {
      if (listType !== "bulletList") flushList();
      listType = "bulletList";
      listItems.push(ul[1]);
    } else if (h) {
      flushList();
      // Clamp to H1-H3 so AI-returned [H4]+ don't render headings the writer
      // can't easily format back with the toolbar (which only goes to H3).
      const raw = parseInt(h[1]);
      const level = raw > 3 ? 3 : raw < 1 ? 1 : raw;
      nodes.push({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: h[2] }],
      });
    } else if (p) {
      flushList();
      nodes.push({
        type: "paragraph",
        content: [{ type: "text", text: p[1] }],
      });
    } else {
      // Untagged fallback — strip any leading [TAG] prefix the AI emitted that
      // our known tags didn't match (e.g. [BQ], [CODE], [NOTE]). Without this
      // the bracketed marker leaks into the paragraph as literal text, which
      // writers have hit in practice. Also strip markdown bullet/number/bold
      // markers while we're here.
      const t = line
        .replace(/^\[[A-Z0-9_-]+\]\s*/i, "")
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "");
      if (t) {
        flushList();
        nodes.push({ type: "paragraph", content: [{ type: "text", text: t }] });
      }
    }
  }
  flushList();
  return nodes;
}

// djb2 hash of arbitrary string — used to correlate client-side content state
// with server-side save-trace logs. Not cryptographic.
function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Thin adapter — delegates to the shared clientTrace helper which buffers +
// POSTs to /api/client-trace so the events land in Cloud Run, not just devtools.
function trace(event: string, data: Record<string, unknown> = {}): void {
  clientTrace(event, data);
}

interface EditorProps {
  documentId: string;
  tabId: string;
  initialContent: string | null;
  isOwner: boolean;
  activeCommentId: string | null;
  onAIEditRequest?: (
    displayText: string,
    taggedText: string,
    taggedBlocks: TaggedBlock[],
    from: number,
    to: number,
    surroundingContext: string
  ) => void;
  onAddComment?: (commentMarkId: string, quotedText: string, from: number, to: number) => void;
  onCommentMarkClick?: (commentMarkId: string) => void;
  onHeadingsChange?: (headings: HeadingItem[]) => void;
}

export interface EditorHandle {
  scrollToComment: (commentId: string) => void;
  removeCommentMark: (commentId: string) => void;
  applyCommentMark: (commentMarkId: string, from: number, to: number) => void;
  replaceRange: (
    taggedAIResponse: string,
    originalBlocks: TaggedBlock[],
    selectionFrom: number,
    selectionTo: number
  ) => void;
  getFullText: () => string;
  getContentJSON: () => string | null;
  isEmpty: () => boolean;
  setFullContent: (content: string) => void;
  findAndReplace: (original: string, replacement: string) => void;
  highlightSelection: (from: number, to: number, color: string) => void;
  removeHighlight: (from: number, to: number) => void;
  scrollToHeading: (pos: number) => void;
  scrollToHeadingByText: (text: string) => boolean;
  // Synchronously clears the pending debounced save and awaits a fresh PUT of
  // the current editor content. Parent calls this before switching tabs so
  // in-progress work is never eaten by the unmount. Resolves regardless of
  // save success; inspect Cloud Run logs for failures.
  flushPendingSave: () => Promise<void>;
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    documentId,
    tabId,
    initialContent,
    isOwner,
    activeCommentId,
    onAIEditRequest,
    onAddComment,
    onCommentMarkClick,
    onHeadingsChange,
  },
  ref
) {
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">(
    "saved"
  );
  const saveStatusRef = useRef<"saved" | "saving" | "unsaved">("saved");
  useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);
  // Non-null when the last save attempt failed (HTTP error or network throw).
  // Surfaced as a visible banner so silent 401/403/500 can't mask data loss.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Server-side updatedAt from the last PUT response. Used by the poll to
  // recognise our own saves and avoid false conflict banners.
  const lastSavedServerUpdatedAtRef = useRef<string | null>(null);
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);
  // Stable per-tab id — threaded into save/poll logs on both client and server
  // so we can correlate events across the two in Cloud Run.
  const tabIdRef = useRef<string>(newId());
  // Conflict state: set when the poll detects structural content changes from another tab.
  const [conflictDetected, setConflictDetected] = useState(false);
  const [pendingServerContent, setPendingServerContent] = useState<object | null>(null);

  // One-time mount log + visibility change tracking (hypothesis E: browsers
  // throttle setInterval on backgrounded tabs, so a reviewer's poll can go
  // minutes without firing — making their local content arbitrarily stale).
  useEffect(() => {
    trace("client.editor.mount", {
      docId: documentId,
      docTabId: tabId,
      tabId: tabIdRef.current,
      isOwner,
      initialBytes: initialContent?.length ?? 0,
      initialHash: initialContent ? contentHash(initialContent) : null,
      visibility: typeof document !== "undefined" ? document.visibilityState : null,
    });
    if (typeof document === "undefined") return;
    let hiddenAt: number | null = null;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        trace("client.visibility.hidden", {
          docId: documentId,
          tabId: tabIdRef.current,
        });
      } else {
        trace("client.visibility.visible", {
          docId: documentId,
          tabId: tabIdRef.current,
          hiddenDurationMs: hiddenAt ? Date.now() - hiddenAt : null,
        });
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [documentId, isOwner, initialContent]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Start writing your script...",
      }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Link.configure({
        openOnClick: false,
      }),
      CharacterCount,
      CommentMark,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
    ],
    content: initialContent ? JSON.parse(initialContent) : undefined,
    editable: isOwner,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (!isOwner) return;
      setSaveStatus("unsaved");

      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        saveDocument(editor.getJSON());
      }, 1000);
    },
  });

  useImperativeHandle(ref, () => ({
    removeCommentMark(commentId: string) {
      removeCommentMark(commentId);
    },
    applyCommentMark(commentMarkId: string, from: number, to: number) {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setCommentMark(commentMarkId)
        .run();
      if (!wasEditable) editor.setEditable(false);
      triggerSave();
    },
    replaceRange(
      taggedAIResponse: string,
      originalBlocks: TaggedBlock[],
      selectionFrom: number,
      selectionTo: number
    ) {
      if (!editor) return;
      const { state, view } = editor;

      const aiLines = taggedAIResponse.split("\n").filter((l) => l.trim());

      // Inline (single block): strip tags, use insertText to preserve marks.
      if (originalBlocks.length <= 1) {
        const strippedText = taggedAIResponse
          .replace(/^\[(?:H\d|OL|UL|P)\]\s*/, "")
          .trim();
        view.dispatch(state.tr.insertText(strippedText, selectionFrom, selectionTo));
        editor.commands.focus();
        triggerSave();
        return;
      }

      // Multi-block: replace exactly the blocks the user selected — no
      // expansion to the enclosing list/container. extractTaggedBlocks already
      // captured each block at its full node boundaries (paragraph/heading/
      // listItem), so the first block's from and the last block's to define
      // the true minimal range the user meant to edit.
      //
      // Previously we walked up to the outermost list/heading, which meant a
      // "rewrite items 3-4" on a 10-item list clobbered all 10 items.
      const rangeStart = originalBlocks[0].from;
      const rangeEnd = originalBlocks[originalBlocks.length - 1].to;

      let nodes = parseTaggedLines(aiLines);

      // If the selection was entirely listItems of one list type and the AI
      // wrapped its output in a single same-type list, unwrap so we splice
      // items directly into the existing list instead of nesting a list.
      const firstTag = originalBlocks[0].line.match(/^\[(UL|OL)\]/)?.[1];
      const allItems =
        firstTag != null &&
        originalBlocks.every((b) => b.line.startsWith(`[${firstTag}] `));
      if (allItems) {
        const expectedList = firstTag === "UL" ? "bulletList" : "orderedList";
        if (nodes.length === 1) {
          const only = nodes[0] as { type?: string; content?: object[] };
          if (only.type === expectedList && Array.isArray(only.content)) {
            nodes = only.content;
          }
        }
      }

      editor
        .chain()
        .focus()
        .insertContentAt({ from: rangeStart, to: rangeEnd }, nodes)
        .run();
      triggerSave();
    },
    scrollToComment(commentId: string) {
      if (!editor) return;
      const { doc } = editor.state;
      let found = false;
      doc.descendants((node, pos) => {
        if (found) return false;
        for (const mark of node.marks) {
          if (
            mark.type.name === "commentMark" &&
            mark.attrs.commentId === commentId
          ) {
            // Walk up from any node type (text nodes included) to find an HTMLElement
            let el: Node | null = editor.view.domAtPos(pos).node;
            while (el && !(el instanceof HTMLElement)) {
              el = el.parentNode;
            }
            if (el instanceof HTMLElement) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            found = true;
            return false;
          }
        }
      });
    },
    getFullText() {
      if (!editor) return "";
      return editor.state.doc.textContent;
    },
    getContentJSON() {
      if (!editor) return null;
      try {
        return JSON.stringify(editor.getJSON());
      } catch {
        return null;
      }
    },
    isEmpty() {
      return !editor || editor.isEmpty;
    },
    setFullContent(content: string) {
      if (!editor) return;
      // Parse tagged lines into Tiptap JSON, then set as content
      const lines = content.split("\n").filter((l) => l.trim());
      const hasStructuralTags = lines.some((l) =>
        /^\[(?:H\d|OL|UL|P|HR)\]/.test(l)
      );
      if (hasStructuralTags) {
        const nodes = parseTaggedLines(lines);
        editor.commands.setContent({ type: "doc", content: nodes as [] });
      } else {
        // Plain text — wrap paragraphs
        const paragraphs = content
          .split("\n\n")
          .filter((p) => p.trim())
          .map((p) => `<p>${p.trim()}</p>`)
          .join("");
        editor.commands.setContent(paragraphs || "<p></p>");
      }
      triggerSave();
    },
    highlightSelection(from: number, to: number, color: string) {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setHighlight({ color })
        .run();
      if (!wasEditable) editor.setEditable(false);
    },
    removeHighlight(from: number, to: number) {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .unsetHighlight()
        .run();
      if (!wasEditable) editor.setEditable(false);
    },
    scrollToHeading(pos: number) {
      if (!editor) return;
      editor.commands.setTextSelection(pos + 1);
      try {
        const domNode = editor.view.domAtPos(pos + 1).node as HTMLElement;
        domNode?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      } catch {
        // ignore if position is out of range
      }
    },
    // Find the first heading whose text matches (case-insensitive, trimmed)
    // and scroll to it. Returns true when found. Used by the tab rail's
    // nested sub-items — each sub-item is derived from a [H3] heading.
    scrollToHeadingByText(text: string): boolean {
      if (!editor) return false;
      const needle = text.trim().toLowerCase();
      if (!needle) return false;
      let hit = false;
      editor.state.doc.descendants((node, pos) => {
        if (hit) return false;
        if (node.type.name === "heading") {
          if (node.textContent.trim().toLowerCase() === needle) {
            try {
              const domNode = editor.view.domAtPos(pos + 1).node as HTMLElement;
              let el: Node | null = domNode;
              while (el && !(el instanceof HTMLElement)) el = el.parentNode;
              (el as HTMLElement | null)?.scrollIntoView?.({
                behavior: "smooth",
                block: "start",
              });
            } catch {
              /* ignore */
            }
            hit = true;
            return false;
          }
        }
      });
      return hit;
    },
    findAndReplace(original: string, replacement: string) {
      if (!editor) return;
      const { doc } = editor.state;
      let targetPos = -1;
      let targetEnd = -1;

      // Clean the search text: strip quotes, extra whitespace, tags (opening and closing)
      const cleanSearch = original
        .replace(/^\s*["'"]\s*/, "")
        .replace(/\s*["'"]\s*$/, "")
        .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")
        .replace(/^\[(?:H\d|OL|UL|P)\]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanSearch) return;

      // Strategy 1: Exact match in text nodes
      doc.descendants((node, pos) => {
        if (targetPos >= 0) return false;
        if (node.isText && node.text) {
          const idx = node.text.indexOf(cleanSearch);
          if (idx >= 0) {
            targetPos = pos + idx;
            targetEnd = targetPos + cleanSearch.length;
            return false;
          }
        }
      });

      // Strategy 2: Match in block textContent
      if (targetPos < 0) {
        doc.descendants((node, pos) => {
          if (targetPos >= 0) return false;
          if (node.isBlock) {
            const blockText = node.textContent;
            const idx = blockText.indexOf(cleanSearch);
            if (idx >= 0) {
              targetPos = pos + 1 + idx;
              targetEnd = targetPos + cleanSearch.length;
              return false;
            }
          }
        });
      }

      // Strategy 3: Cross-block matching (original may span multiple document blocks)
      if (targetPos < 0) {
        const blocks: { pos: number; end: number; text: string }[] = [];
        doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent.trim()) {
            blocks.push({
              pos: pos + 1,
              end: pos + node.nodeSize - 1,
              text: node.textContent,
            });
          }
        });

        for (let i = 0; i < blocks.length && targetPos < 0; i++) {
          let concatDirect = "";
          let concatSpaced = "";
          for (let j = i; j < Math.min(i + 30, blocks.length); j++) {
            concatDirect += blocks[j].text;
            concatSpaced += (j > i ? " " : "") + blocks[j].text;
            if (
              concatDirect.includes(cleanSearch) ||
              concatSpaced.includes(cleanSearch)
            ) {
              targetPos = blocks[i].pos;
              targetEnd = blocks[j].end;
              break;
            }
          }
        }
      }

      // Strategy 4: Try progressively shorter prefixes (AI may have truncated)
      if (targetPos < 0) {
        const minLen = 15;
        for (
          let len = Math.min(cleanSearch.length, 60);
          len >= minLen;
          len -= 10
        ) {
          const prefix = cleanSearch.slice(0, len);
          doc.descendants((node, pos) => {
            if (targetPos >= 0) return false;
            if (node.isBlock) {
              const blockText = node.textContent;
              const idx = blockText.indexOf(prefix);
              if (idx >= 0) {
                // Found a prefix match — replace the whole block text
                // that starts with this prefix up to the end of the line
                targetPos = pos + 1 + idx;
                const endOfMatch = blockText.indexOf("\n", idx);
                targetEnd =
                  pos +
                  1 +
                  (endOfMatch >= 0 ? endOfMatch : blockText.length);
                return false;
              }
            }
          });
          if (targetPos >= 0) break;
        }
      }

      if (targetPos >= 0 && targetEnd > targetPos) {
        // Pre-process: strip closing tags and split inline tag sequences into lines
        const cleanedReplacement = replacement
          .replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "")           // strip closing tags
          .replace(/(.)(\[(?:H\d|OL|UL|P|HR)\])/g, "$1\n$2"); // newline before inline tags

        // Check if replacement has structural tags
        const lines = cleanedReplacement.split("\n").filter((l) => l.trim());
        const hasStructuralTags = lines.some((l) =>
          /^\[(?:H\d|OL|UL|P|HR)\]/.test(l)
        );

        if (hasStructuralTags) {
          // Expand to block boundaries and replace with parsed nodes
          const state = editor.state;
          const $from = state.doc.resolve(targetPos);
          const $to = state.doc.resolve(targetEnd);
          let expandedFrom = targetPos;
          let expandedTo = targetEnd;
          for (let d = $from.depth; d > 0; d--) {
            const name = $from.node(d).type.name;
            if (
              ["orderedList", "bulletList", "heading"].includes(name) ||
              (name === "paragraph" && $from.node(d - 1).type.name === "doc")
            ) {
              expandedFrom = $from.before(d);
              break;
            }
          }
          for (let d = $to.depth; d > 0; d--) {
            const name = $to.node(d).type.name;
            if (
              ["orderedList", "bulletList", "heading"].includes(name) ||
              (name === "paragraph" && $to.node(d - 1).type.name === "doc")
            ) {
              expandedTo = $to.after(d);
              break;
            }
          }
          const nodes = parseTaggedLines(lines);
          editor
            .chain()
            .focus()
            .insertContentAt({ from: expandedFrom, to: expandedTo }, nodes)
            .run();
        } else {
          // Plain text replacement (strip any remaining closing tags)
          const plainText = replacement.replace(/\[\/(?:H\d|OL|UL|P|HR)\]/g, "").trim();
          editor.view.dispatch(
            editor.state.tr.insertText(plainText, targetPos, targetEnd)
          );
        }
        triggerSave();
      }
    },
    async flushPendingSave() {
      if (!editor || !isOwner) return;
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
      }
      // Only flush if there's actually unsaved work. A "saved" state means the
      // server already has what's in the editor — an extra PUT is pure waste.
      if (saveStatusRef.current === "saved") return;
      trace("client.flushPendingSave.start", {
        docId: documentId,
        docTabId: tabId,
        saveStatus: saveStatusRef.current,
      });
      try {
        await saveDocument(editor.getJSON());
        trace("client.flushPendingSave.ok", {
          docId: documentId,
          docTabId: tabId,
        });
      } catch (err) {
        trace("client.flushPendingSave.fail", {
          docId: documentId,
          docTabId: tabId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    },
  }));

  // On unmount (tab switch, navigation away, page close), fire any pending
  // debounced save. Using sendBeacon via saveDocument isn't an option here —
  // the fetch must run during the render cycle. For page-close we rely on
  // clientTrace's pagehide handler + the server-side save already being in
  // flight. For tab switches the parent should call flushPendingSave first.
  useEffect(() => {
    return () => {
      if (!editor || !isOwner) return;
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
      }
      if (saveStatusRef.current !== "saved") {
        trace("client.unmount.unsavedWork", {
          docId: documentId,
          docTabId: tabId,
          saveStatus: saveStatusRef.current,
        });
        // Best-effort. The parent's handleTabSwitch should have awaited
        // flushPendingSave before unmount, so this catches unmount paths
        // that bypass the switch handler (route change, auth expiry, etc.).
        try {
          saveDocument(editor.getJSON());
        } catch {
          /* logged via trace above */
        }
      } else {
        trace("client.unmount.clean", {
          docId: documentId,
          docTabId: tabId,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, documentId, tabId, isOwner]);

  // Inject a dynamic <style> tag for active comment highlighting.
  // This survives Tiptap DOM re-renders (unlike manually adding classes to mark spans).
  useEffect(() => {
    const styleId = "active-comment-style";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    if (activeCommentId) {
      // Dim all comment highlights, then brighten the active one
      styleEl.textContent = `
        .comment-highlight { background-color: rgba(255,212,0,0.1) !important; border-bottom-color: rgba(255,180,0,0.15) !important; }
        .comment-highlight[data-comment-id="${activeCommentId}"] { background-color: rgba(251,146,60,0.45) !important; border-bottom: 2px solid rgba(234,88,12,0.8) !important; }
      `;
    } else {
      styleEl.textContent = "";
    }

    return () => {
      if (styleEl) styleEl.textContent = "";
    };
  }, [activeCommentId]);

  // Extract headings and notify parent (rAF-batched for performance)
  useEffect(() => {
    if (!editor || !onHeadingsChange) return;
    let rafId: ReturnType<typeof requestAnimationFrame>;
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const headings: HeadingItem[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "heading" && [1, 2, 3].includes(node.attrs.level)) {
            headings.push({ level: node.attrs.level as 1 | 2 | 3, text: node.textContent, pos });
          }
        });
        onHeadingsChange(headings);
      });
    };
    editor.on("transaction", schedule);
    schedule(); // fire once on mount
    return () => {
      cancelAnimationFrame(rafId);
      editor.off("transaction", schedule);
    };
  }, [editor, onHeadingsChange]);

  const saveDocument = useCallback(
    async (content: object) => {
      const reqId = newId();
      const contentStr = JSON.stringify(content);
      const tStart =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      trace("client.save.start", {
        reqId,
        docId: documentId,
        docTabId: tabId,
        tabId: tabIdRef.current,
        isOwner,
        bytes: contentStr.length,
        hash: contentHash(contentStr),
      });
      setSaveStatus("saving");
      try {
        const payload: Record<string, unknown> = { content: contentStr };
        // Non-owners can only save comment mark changes (server enforces too).
        if (!isOwner) payload.commentMarkOnly = true;
        const res = await fetch(
          `/api/documents/${documentId}/tabs/${tabId}/content`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Tab-Id": tabIdRef.current,
              "X-Doc-Tab-Id": tabId,
              "X-Req-Id": reqId,
              "X-Client-Ts": new Date().toISOString(),
            },
            body: JSON.stringify(payload),
          }
        );
        const latency = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            tStart
        );
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.updatedAt) lastSavedServerUpdatedAtRef.current = data.updatedAt;
          setSaveStatus("saved");
          setSaveError(null);
          trace("client.save.ok", {
            reqId,
            status: res.status,
            updatedAt: data.updatedAt ?? null,
            latencyMs: latency,
          });
        } else {
          // DON'T mask non-2xx as "saved" — that was the original silent-failure
          // bug. Surface it, clear the server-updatedAt ref so poll won't
          // falsely suppress a conflict banner on the next tick, and flip state
          // back to "unsaved" so the next keystroke will retry via debounce.
          const errBody = await res.text().catch(() => "");
          lastSavedServerUpdatedAtRef.current = null;
          setSaveStatus("unsaved");
          setSaveError(
            `Save failed (HTTP ${res.status}). ${errBody.slice(0, 200)}`
          );
          trace("client.save.fail", {
            reqId,
            status: res.status,
            bodyPreview: errBody.slice(0, 200),
            latencyMs: latency,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSaveStatus("unsaved");
        setSaveError(`Network error while saving: ${msg}`);
        trace("client.save.throw", { reqId, err: msg });
      }
    },
    [documentId, tabId, isOwner]
  );

  // Poll for tab updates (picks up comment marks added by reviewers).
  // For owners, the poll ONLY auto-applies comment-mark-only changes. Any structural
  // content difference (e.g. same tab open in another window with stale content) is
  // surfaced as a conflict banner — never silently applied.
  useEffect(() => {
    if (!editor) return;
    const poll = async () => {
      const reqId = newId();
      try {
        const res = await fetch(
          `/api/documents/${documentId}/tabs/${tabId}/content`,
          {
            headers: {
              "X-Tab-Id": tabIdRef.current,
              "X-Doc-Tab-Id": tabId,
              "X-Req-Id": reqId,
              "X-Client-Ts": new Date().toISOString(),
            },
          }
        );
        if (!res.ok) {
          trace("client.poll.fail", {
            reqId,
            docId: documentId,
            tabId: tabIdRef.current,
            status: res.status,
          });
          return;
        }
        const data = await res.json();
        if (!data.content) return;

        const serverContent = JSON.parse(data.content);
        const localContent = editor.getJSON();
        const serverStr = JSON.stringify(serverContent);
        const localStr = JSON.stringify(localContent);

        // Identical bytes → obvious no-op.
        if (serverStr === localStr) return;
        // Tiptap can add default null attrs (e.g. textAlign: null) on load
        // that aren't in the stored JSON. Treat those as equal so a
        // freshly-split doc doesn't fire a false conflict banner on first open.
        if (isNormalisedEqual(serverContent, localContent)) return;

        const commentMarkOnly = isCommentMarkOnlyDiff(
          serverContent,
          localContent
        );

        const pollCtx = {
          reqId,
          docId: documentId,
          tabId: tabIdRef.current,
          isOwner,
          saveStatus: saveStatusRef.current,
          refUpdatedAt: lastSavedServerUpdatedAtRef.current,
          serverUpdatedAt: data.updatedAt,
          localHash: contentHash(localStr),
          serverHash: contentHash(serverStr),
          localBytes: localStr.length,
          serverBytes: serverStr.length,
          commentMarkOnly,
        };

        const restoreCursor = () => {
          try {
            const { from } = editor.state.selection;
            editor.commands.setTextSelection(
              Math.min(from, editor.state.doc.content.size)
            );
          } catch { /* ignore invalid position */ }
        };

        if (!isOwner) {
          // Reviewers are read-only — always sync to server
          trace("client.poll.reviewer.applyServer", pollCtx);
          editor.commands.setContent(serverContent, { emitUpdate: false });
          restoreCursor();
          return;
        }

        // Owner path: skip if local changes are in flight
        if (saveStatusRef.current !== "saved") {
          trace("client.poll.skip.inflight", pollCtx);
          return;
        }

        // Skip if this updatedAt is the one we just saved (avoids a race where
        // the poll response arrives just after our save but before the next edit)
        if (
          lastSavedServerUpdatedAtRef.current &&
          data.updatedAt === lastSavedServerUpdatedAtRef.current
        ) {
          trace("client.poll.skip.ownSave", pollCtx);
          return;
        }

        if (commentMarkOnly) {
          // Only comment marks differ — reviewer added a highlight. Apply silently.
          trace("client.poll.applyCommentMarks", pollCtx);
          editor.commands.setContent(serverContent, { emitUpdate: false });
          restoreCursor();
        } else {
          // Structural content differs from another instance. Never silently revert —
          // surface a banner so the writer decides.
          trace("client.poll.conflict", pollCtx);
          setPendingServerContent(serverContent);
          setConflictDetected(true);
        }
      } catch (err) {
        trace("client.poll.throw", {
          reqId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [editor, documentId, tabId, isOwner]);

  // Keyboard shortcut for manual save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (editor && isOwner) {
          saveDocument(editor.getJSON());
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editor, isOwner, saveDocument]);

  const handleAIEdit = useCallback(() => {
    if (!editor || !onAIEditRequest) return;
    const { from, to } = editor.state.selection;
    const displayText = editor.state.doc.textBetween(from, to, "\n");
    if (!displayText.trim()) return;

    const taggedBlocks = extractTaggedBlocks(editor.state, from, to);
    const taggedText =
      taggedBlocks.length > 0
        ? taggedBlocks.map((b) => b.line).join("\n")
        : `[P] ${displayText}`;

    // Collect ~3 blocks before and after the selection as surrounding context.
    // This tells the AI what heading levels are in use, whether lists continue, etc.
    const beforeBlocks = extractTaggedBlocks(
      editor.state,
      Math.max(0, from - 600),
      from
    ).slice(-3);
    const afterBlocks = extractTaggedBlocks(
      editor.state,
      to,
      Math.min(editor.state.doc.content.size, to + 600)
    ).slice(0, 3);

    const surroundingContext =
      beforeBlocks.length > 0 || afterBlocks.length > 0
        ? `\n## Surrounding Context (for formatting reference only — do NOT reproduce)\n` +
          (beforeBlocks.length > 0
            ? `Before selection:\n${beforeBlocks.map((b) => b.line).join("\n")}\n`
            : "") +
          (afterBlocks.length > 0
            ? `After selection:\n${afterBlocks.map((b) => b.line).join("\n")}`
            : "")
        : "";

    onAIEditRequest(displayText, taggedText, taggedBlocks, from, to, surroundingContext);
  }, [editor, onAIEditRequest]);

  const handleAddComment = useCallback(() => {
    if (!editor || !onAddComment) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;

    const commentMarkId = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Don't apply the mark yet — only apply it once the comment is actually posted.
    // This prevents orphan highlights when the user cancels without posting.
    onAddComment(commentMarkId, selectedText, from, to);
  }, [editor, onAddComment]);

  const removeCommentMark = useCallback(
    (commentMarkId: string) => {
      if (!editor) return;
      const wasEditable = editor.isEditable;
      if (!wasEditable) editor.setEditable(true);

      editor.commands.unsetCommentMark(commentMarkId);

      if (!wasEditable) editor.setEditable(false);

      triggerSave();
    },
    [editor]
  );

  const triggerSave = useCallback(() => {
    if (!editor) return;
    setSaveStatus("unsaved");
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveDocument(editor.getJSON());
    }, 500);
  }, [editor, saveDocument]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      {isOwner && <EditorToolbar editor={editor} />}

      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-1.5 text-xs text-gray-500">
        <div className="flex items-center gap-3">
          {isOwner ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-green-700">
              Owner
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
              Reviewer
            </span>
          )}
          <span>
            {saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "saved"
                ? "Saved"
                : "Unsaved changes"}
          </span>
        </div>
        {editor && (
          <div className="flex items-center gap-3">
            <span>{editor.storage.characterCount.words()} words</span>
            <span>{editor.storage.characterCount.characters()} chars</span>
          </div>
        )}
      </div>

      {/* Save error banner — shown when a PUT failed (HTTP error or network).
          Previously these were silently swallowed and saveStatus still said "Saved". */}
      {saveError && (
        <div className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <span className="flex-1">{saveError}</span>
          <button
            type="button"
            onClick={() => {
              if (editor && isOwner) {
                trace("client.saveError.retry", {
                  docId: documentId,
                  tabId: tabIdRef.current,
                });
                saveDocument(editor.getJSON());
              }
            }}
            className="rounded bg-red-100 px-2 py-1 font-medium hover:bg-red-200 transition-colors"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="rounded bg-white border border-red-200 px-2 py-1 font-medium hover:bg-red-50 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Conflict banner — fires when the 5s poll sees the server's copy of
          this tab differs from what's in the editor. Copy is deliberately
          neutral ("this window" vs "saved version") because the cause is
          often not another window — it can be a stale remount, a second
          device, or a reviewer's tab. We show the raw byte sizes so the
          writer can judge which version is theirs before deciding. */}
      {conflictDetected && pendingServerContent && editor && (() => {
        const localBytes = JSON.stringify(editor.getJSON()).length;
        const serverBytes = JSON.stringify(pendingServerContent).length;
        const wouldShrinkPct =
          localBytes > 0
            ? Math.round((1 - serverBytes / localBytes) * 100)
            : 0;
        const willLoseContent = wouldShrinkPct >= 10;
        return (
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <span className="flex-1">
              <strong>Content mismatch.</strong> This window has{" "}
              {(localBytes / 1024).toFixed(1)} kb, the saved version has{" "}
              {(serverBytes / 1024).toFixed(1)} kb. Choose which to keep.
            </span>
            <button
              type="button"
              onClick={() => {
                trace("client.banner.keepLocal", {
                  docId: documentId,
                  docTabId: tabId,
                  localBytes,
                  serverBytes,
                });
                setConflictDetected(false);
                setPendingServerContent(null);
                if (isOwner) saveDocument(editor.getJSON());
              }}
              className="rounded bg-amber-700 px-3 py-1 font-medium text-white hover:bg-amber-800 transition-colors"
            >
              Keep what I see (re-save)
            </button>
            <button
              type="button"
              onClick={() => {
                if (willLoseContent) {
                  const msg = `Loading the saved version will remove about ${wouldShrinkPct}% of what you currently see (${(
                    (localBytes - serverBytes) /
                    1024
                  ).toFixed(1)} kb). This cannot be undone from here. Continue?`;
                  if (!window.confirm(msg)) {
                    trace("client.banner.applyServer.cancelled", {
                      docId: documentId,
                      docTabId: tabId,
                      localBytes,
                      serverBytes,
                      wouldShrinkPct,
                    });
                    return;
                  }
                }
                trace("client.banner.applyServer", {
                  docId: documentId,
                  docTabId: tabId,
                  localBytesDiscarded: localBytes,
                  serverBytes,
                  wouldShrinkPct,
                });
                editor.commands.setContent(pendingServerContent, {
                  emitUpdate: false,
                });
                lastSavedServerUpdatedAtRef.current = null;
                setConflictDetected(false);
                setPendingServerContent(null);
              }}
              className="rounded border border-amber-300 bg-white px-3 py-1 font-medium text-amber-800 hover:bg-amber-100 transition-colors"
            >
              Load saved version
            </button>
          </div>
        );
      })()}

      {/* Editor */}
      <div
        className="flex-1 overflow-y-auto"
        onClick={(e) => {
          if (!onCommentMarkClick) return;
          const markEl = (e.target as HTMLElement).closest('[data-comment-id]') as HTMLElement | null;
          if (markEl) onCommentMarkClick(markEl.getAttribute('data-comment-id')!);
        }}
      >
        <div className="mx-auto max-w-4xl px-8 py-8">
          {editor && (
            <BubbleMenu
              editor={editor}
              shouldShow={({ state }) => {
                const { from, to } = state.selection;
                return from !== to;
              }}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 shadow-lg"
            >
              {isOwner && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      editor.chain().focus().toggleBold().run()
                    }
                    className={`rounded px-1.5 py-0.5 text-sm ${
                      editor.isActive("bold")
                        ? "bg-gray-200 font-bold"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      editor.chain().focus().toggleItalic().run()
                    }
                    className={`rounded px-1.5 py-0.5 text-sm italic ${
                      editor.isActive("italic")
                        ? "bg-gray-200"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    I
                  </button>
                  <div className="mx-1 h-4 w-px bg-gray-200" />
                  {onAIEditRequest && (
                    <button
                      type="button"
                      onClick={handleAIEdit}
                      className="rounded bg-indigo-50 px-2 py-0.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100"
                    >
                      Edit with AI
                    </button>
                  )}
                </>
              )}
              {/* Comment button — available to everyone */}
              {onAddComment && (
                <>
                  {isOwner && <div className="mx-1 h-4 w-px bg-gray-200" />}
                  <button
                    type="button"
                    onClick={handleAddComment}
                    className="rounded bg-yellow-50 px-2 py-0.5 text-sm font-medium text-yellow-700 hover:bg-yellow-100"
                  >
                    Comment
                  </button>
                </>
              )}
            </BubbleMenu>
          )}
          <EditorContent
            editor={editor}
            className="prose prose-lg max-w-none focus:outline-none [&_.tiptap]:min-h-[60vh] [&_.tiptap]:outline-none [&_.tiptap_p.is-editor-empty:first-child::before]:text-gray-400 [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none"
          />
        </div>
      </div>
    </div>
  );
});

export default Editor;
