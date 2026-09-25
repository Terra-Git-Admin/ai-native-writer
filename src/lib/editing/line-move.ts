import type { KeyboardEvent } from "react";

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  if (valueSetter) {
    valueSetter.call(textarea, value);
  } else {
    textarea.value = value;
  }
}

export function moveTextareaSelectedLines(
  textarea: HTMLTextAreaElement,
  direction: "up" | "down"
): boolean {
  if (textarea.disabled || textarea.readOnly) return false;
  if (textarea.rows === 1) return false;

  const value = textarea.value;
  if (!value.includes("\n")) return false;

  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  let lineEnd = value.indexOf("\n", selectionEnd);
  if (lineEnd === -1) lineEnd = value.length;
  if (selectionEnd > selectionStart && value[selectionEnd - 1] === "\n") {
    lineEnd = selectionEnd - 1;
  }

  const block = value.slice(lineStart, lineEnd);
  if (!block) return false;

  if (direction === "up") {
    if (lineStart === 0) return false;
    const previousLineEnd = lineStart - 1;
    const previousLineStart = value.lastIndexOf("\n", previousLineEnd - 1) + 1;
    const previousLine = value.slice(previousLineStart, previousLineEnd);
    const before = value.slice(0, previousLineStart);
    const after = value.slice(lineEnd);
    setTextareaValue(textarea, `${before}${block}\n${previousLine}${after}`);
    const delta = lineStart - previousLineStart;
    textarea.setSelectionRange(selectionStart - delta, selectionEnd - delta);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  if (lineEnd === value.length) return false;
  const nextLineStart = lineEnd + 1;
  let nextLineEnd = value.indexOf("\n", nextLineStart);
  if (nextLineEnd === -1) nextLineEnd = value.length;
  const nextLine = value.slice(nextLineStart, nextLineEnd);
  const before = value.slice(0, lineStart);
  const after = value.slice(nextLineEnd);
  setTextareaValue(textarea, `${before}${nextLine}\n${block}${after}`);
  const delta = nextLineEnd - lineEnd;
  textarea.setSelectionRange(selectionStart + delta, selectionEnd + delta);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

export function handleTextareaLineMoveKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>
): boolean {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;

  const moved = moveTextareaSelectedLines(
    event.currentTarget,
    event.key === "ArrowUp" ? "up" : "down"
  );
  if (moved) {
    event.preventDefault();
    event.stopPropagation();
  }
  return moved;
}
