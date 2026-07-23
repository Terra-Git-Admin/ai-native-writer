"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useEffect, useCallback, memo, useState } from "react";

// Decorates "BECAUSE OF THAT" and "BUT THEN" with .causal-phrase class for CSS styling
const CAUSAL_PHRASES = ["BECAUSE OF THAT", "BUT THEN"];
const CausalPhraseHighlight = Extension.create({
  name: "causalPhraseHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("causalPhraseHighlight"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const phrase of CAUSAL_PHRASES) {
                let start = 0;
                while (true) {
                  const idx = node.text.indexOf(phrase, start);
                  if (idx === -1) break;
                  decorations.push(
                    Decoration.inline(pos + idx, pos + idx + phrase.length, { class: "causal-phrase" })
                  );
                  start = idx + phrase.length;
                }
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

interface PlaygroundBlockProps {
  label: string;
  content: string | null;
  placeholder: string;
  isStreaming?: boolean;
  streamingText?: string;
  onContentChange: (json: string) => void;
  // Optional header action button (e.g. "Finalize" on Story Logic).
  // When omitted, no button is rendered.
  onAction?: () => Promise<void>;
  actionLabel?: string;
  actionDisabled?: boolean;
}

function PlaygroundBlock({
  label,
  content,
  placeholder,
  isStreaming = false,
  streamingText = "",
  onContentChange,
  onAction,
  actionLabel = "Promote →",
  actionDisabled = false,
}: PlaygroundBlockProps) {
  const [actionDone, setActionDone] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      TextStyle,
      Color,
      CausalPhraseHighlight,
    ],
    content: content ? JSON.parse(content) : undefined,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onContentChange(JSON.stringify(editor.getJSON()));
    },
  });

  // Sync content from parent when it changes externally (populate/refresh)
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    if (content === null || content === undefined) {
      editor.commands.clearContent();
      return;
    }
    if (current !== content) {
      editor.commands.setContent(JSON.parse(content));
    }
  }, [editor, content]);

  const handleAction = useCallback(async () => {
    if (!onAction) return;
    await onAction();
    setActionDone(true);
    setTimeout(() => setActionDone(false), 2000);
  }, [onAction]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-gray-800">{label}</h3>
        {onAction && (
          <button
            onClick={handleAction}
            disabled={actionDisabled || isStreaming}
            className={`inline-flex items-center rounded px-3 min-h-[44px] text-xs font-medium
              transition-colors duration-200 cursor-pointer
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
              disabled:opacity-30 disabled:cursor-not-allowed
              ${actionDone
                ? "bg-green-50 text-green-700"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
          >
            {actionDone ? `${actionLabel} ✓` : actionLabel}
          </button>
        )}
      </header>

      {isStreaming ? (
        <div
          aria-busy="true"
          className="px-4 py-3 min-h-[120px] rounded-b-lg opacity-90 text-sm text-gray-700 whitespace-pre-wrap"
        >
          {streamingText || <span className="text-gray-400 italic">Connecting…</span>}
        </div>
      ) : (
        <div
          className="px-4 py-3 min-h-[120px] rounded-b-lg playground-prose
            focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset"
        >
          <EditorContent editor={editor} className="text-sm" />
        </div>
      )}
    </section>
  );
}

export default memo(PlaygroundBlock);
