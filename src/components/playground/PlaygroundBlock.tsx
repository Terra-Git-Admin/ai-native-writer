"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { useEffect, useCallback, memo, useState } from "react";

interface PlaygroundBlockProps {
  label: string;
  content: string | null;
  placeholder: string;
  ariaLabel: string;
  isStreaming?: boolean;
  streamingText?: string;
  onContentChange: (json: string) => void;
  onPromote: () => Promise<void>;
  promoteDisabled?: boolean;
}

function PlaygroundBlock({
  label,
  content,
  placeholder,
  ariaLabel,
  isStreaming = false,
  streamingText = "",
  onContentChange,
  onPromote,
  promoteDisabled = false,
}: PlaygroundBlockProps) {
  const [promoteLabel, setPromoteLabel] = useState<"default" | "done">("default");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
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

  const handlePromote = useCallback(async () => {
    await onPromote();
    setPromoteLabel("done");
    setTimeout(() => setPromoteLabel("default"), 2000);
  }, [onPromote]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-gray-800">{label}</h3>
        {!promoteDisabled && (
          <button
            aria-label={ariaLabel}
            onClick={handlePromote}
            className={`inline-flex items-center rounded px-3 min-h-[44px] text-xs font-medium
              transition-colors duration-200 cursor-pointer
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
              disabled:opacity-30 disabled:cursor-not-allowed
              ${promoteLabel === "done"
                ? "bg-green-50 text-green-700"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
          >
            {promoteLabel === "done" ? "Promoted ✓" : "Promote →"}
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
          className="px-4 py-3 min-h-[120px] rounded-b-lg
            focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset"
        >
          <EditorContent editor={editor} className="text-sm text-gray-800" />
        </div>
      )}
    </section>
  );
}

export default memo(PlaygroundBlock);
