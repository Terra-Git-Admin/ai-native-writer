"use client";

import { Editor } from "@tiptap/react";
import { useEffect, useReducer } from "react";

interface EditorToolbarProps {
  editor: Editor | null;
}

const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Mono", value: "ui-monospace, monospace" },
  { label: "Sans", value: "ui-sans-serif, sans-serif" },
];

const FONT_SIZES = [
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "24", value: "24px" },
];

const FONT_COLORS = [
  { label: "Default", value: "" },
  { label: "Black", value: "#000000" },
  { label: "Gray", value: "#6b7280" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
];

function ToolbarButton({
  onClick,
  isActive,
  children,
  title,
}: {
  onClick: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded px-2 py-1 text-sm font-medium transition-colors ${
        isActive
          ? "bg-gray-200 text-gray-900"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="mx-1 h-6 w-px bg-gray-200" />;
}

export default function EditorToolbar({ editor }: EditorToolbarProps) {
  // Re-render when the editor selection or content changes so the toolbar
  // reflects the active marks/nodes at the cursor. Both "selectionUpdate"
  // and "transaction" can fire in the same frame (e.g. typing moves the
  // cursor), so we batch them with rAF to guarantee at most one re-render
  // per frame regardless of event frequency.
  const [, forceUpdate] = useReducer(x => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    let rafId: ReturnType<typeof requestAnimationFrame>;
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(forceUpdate);
    };
    editor.on("selectionUpdate", schedule);
    editor.on("transaction", schedule);
    return () => {
      cancelAnimationFrame(rafId);
      editor.off("selectionUpdate", schedule);
      editor.off("transaction", schedule);
    };
  }, [editor]);

  if (!editor) return null;

  const fontFamily = editor.getAttributes("textStyle").fontFamily || "";
  const fontSize   = editor.getAttributes("textStyle").fontSize   || "";
  const color      = editor.getAttributes("textStyle").color      || "";

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-3 py-2">

      {/* Font Family */}
      <select
        value={fontFamily}
        onChange={(e) => {
          const val = e.target.value;
          if (val) {
            editor.chain().focus().setFontFamily(val).run();
          } else {
            editor.chain().focus().unsetFontFamily().run();
          }
        }}
        title="Font family"
        className="rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-600 hover:border-gray-300 focus:outline-none"
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {/* Font Size */}
      <select
        value={fontSize}
        onChange={(e) => {
          const val = e.target.value;
          if (val) {
            editor.chain().focus().setFontSize(val).run();
          } else {
            editor.chain().focus().unsetFontSize().run();
          }
        }}
        title="Font size"
        className="rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-600 hover:border-gray-300 focus:outline-none w-14"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {/* Font Color */}
      <div className="relative flex items-center" title="Font color">
        <select
          value={color}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              editor.chain().focus().setColor(val).run();
            } else {
              editor.chain().focus().unsetColor().run();
            }
          }}
          title="Font color"
          className="rounded border border-gray-200 bg-white pl-5 pr-1.5 py-1 text-xs text-gray-600 hover:border-gray-300 focus:outline-none w-20"
        >
          {FONT_COLORS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {/* Color swatch overlay */}
        <span
          className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-sm border border-gray-300"
          style={{ backgroundColor: color || "#000000" }}
        />
      </div>

      <Separator />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        isActive={editor.isActive("paragraph")}
        title="Normal text"
      >
        Text
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarButton>

      <Separator />

      {/* Formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold (Cmd+B)"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic (Cmd+I)"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive("underline")}
        title="Underline (Cmd+U)"
      >
        <u>U</u>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="Strikethrough"
      >
        <s>S</s>
      </ToolbarButton>

      <Separator />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet list"
      >
        &bull; List
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered list"
      >
        1. List
      </ToolbarButton>

      <Separator />

      {/* Block */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title="Quote"
      >
        &ldquo; Quote
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        &mdash;
      </ToolbarButton>

      <Separator />

      {/* Alignment */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        isActive={editor.isActive({ textAlign: "left" })}
        title="Align left"
      >
        Left
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        isActive={editor.isActive({ textAlign: "center" })}
        title="Align center"
      >
        Center
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        isActive={editor.isActive({ textAlign: "right" })}
        title="Align right"
      >
        Right
      </ToolbarButton>

      <Separator />

      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (Cmd+Z)"
      >
        Undo
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo (Cmd+Shift+Z)"
      >
        Redo
      </ToolbarButton>
    </div>
  );
}
