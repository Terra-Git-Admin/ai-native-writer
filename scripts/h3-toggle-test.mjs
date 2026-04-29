// Standalone test for toggleHeadingAwareOfSelection.
// Exercises the exact PR #23 fix function against a live Tiptap editor
// to verify whether partial-selection H3 works correctly.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.DocumentFragment = dom.window.DocumentFragment;
globalThis.Range = dom.window.Range;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { Editor } = await import("@tiptap/core");
const StarterKit = (await import("@tiptap/starter-kit")).default;

// Copy of the function from src/components/editor/EditorToolbar.tsx:15
function toggleHeadingAwareOfSelection(editor, level) {
  const { state } = editor;
  const { from, to, empty } = state.selection;

  if (empty) {
    editor.chain().focus().toggleHeading({ level }).run();
    return;
  }

  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if ($from.parent !== $to.parent) {
    editor.chain().focus().toggleHeading({ level }).run();
    return;
  }

  const atBlockStart = $from.parentOffset === 0;
  const atBlockEnd = $to.parentOffset === $to.parent.content.size;
  if (atBlockStart && atBlockEnd) {
    editor.chain().focus().toggleHeading({ level }).run();
    return;
  }

  const chain = editor.chain().focus();
  if (!atBlockEnd) {
    chain.setTextSelection(to).splitBlock();
  }
  if (!atBlockStart) {
    chain.setTextSelection(from).splitBlock();
  }
  chain.toggleHeading({ level }).run();
}

// Same as the above but calls vanilla toggleHeading (pre-PR-#23 behavior,
// also what the Mod-Alt-3 keyboard shortcut does in StarterKit).
function vanillaToggleHeading(editor, level) {
  editor.chain().focus().toggleHeading({ level }).run();
}

function makeEditor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit],
    content: "<p>Hello world how are you today, my friend?</p>",
  });
}

function describeDoc(editor) {
  const doc = editor.getJSON();
  return doc.content.map((node, i) => {
    const text = (node.content || []).map((c) => c.text || "").join("");
    if (node.type === "heading") return `[H${node.attrs.level}] "${text}"`;
    return `[P] "${text}"`;
  }).join(" | ");
}

function findPositionOf(editor, needle) {
  const text = editor.state.doc.textContent;
  const idx = text.indexOf(needle);
  if (idx === -1) throw new Error(`needle not found: ${needle}`);
  return { from: idx + 1, to: idx + 1 + needle.length };
}

async function runCase(label, setup, fn) {
  const editor = makeEditor();
  const before = describeDoc(editor);
  setup(editor);
  const sel = editor.state.selection;
  const selText = editor.state.doc.textBetween(sel.from, sel.to);
  const $from = editor.state.doc.resolve(sel.from);
  const $to = editor.state.doc.resolve(sel.to);
  const atStart = $from.parentOffset === 0;
  const atEnd = $to.parentOffset === $to.parent.content.size;
  fn(editor, 3);
  const after = describeDoc(editor);
  editor.destroy();
  console.log(`\n── ${label} ──`);
  console.log(`  Before:    ${before}`);
  console.log(`  Selection: "${selText}" (atStart=${atStart}, atEnd=${atEnd})`);
  console.log(`  After:     ${after}`);
}

const tests = [
  {
    label: "CASE 1: Mid-paragraph selection (partial, both ends inside)",
    setup: (e) => {
      const { from, to } = findPositionOf(e, "world how");
      e.commands.setTextSelection({ from, to });
    },
  },
  {
    label: "CASE 2: Selection from block start to middle (atStart=true, atEnd=false)",
    setup: (e) => {
      const idx = e.state.doc.textContent.indexOf("Hello world");
      e.commands.setTextSelection({ from: idx + 1, to: idx + 1 + "Hello world".length });
    },
  },
  {
    label: "CASE 3: Selection from middle to block end (atStart=false, atEnd=true)",
    setup: (e) => {
      const text = e.state.doc.textContent;
      const idx = text.indexOf("how are you today, my friend?");
      e.commands.setTextSelection({ from: idx + 1, to: idx + 1 + "how are you today, my friend?".length });
    },
  },
  {
    label: "CASE 4: Full paragraph selected (atStart=true, atEnd=true)",
    setup: (e) => {
      const text = e.state.doc.textContent;
      e.commands.setTextSelection({ from: 1, to: 1 + text.length });
    },
  },
  {
    label: "CASE 5: Empty selection (just cursor in middle)",
    setup: (e) => {
      const idx = e.state.doc.textContent.indexOf("how");
      e.commands.setTextSelection({ from: idx + 1, to: idx + 1 });
    },
  },
];

console.log("════════════════════════════════════════════════════");
console.log("  toggleHeadingAwareOfSelection — PR #23 fix behavior");
console.log("════════════════════════════════════════════════════");

for (const t of tests) {
  await runCase(t.label, t.setup, toggleHeadingAwareOfSelection);
}

console.log("\n\n════════════════════════════════════════════════════");
console.log("  vanillaToggleHeading — what Mod-Alt-3 shortcut does");
console.log("════════════════════════════════════════════════════");

for (const t of tests) {
  await runCase(t.label, t.setup, vanillaToggleHeading);
}

console.log("\n\nDONE");
process.exit(0);
