// Debounced autosave hook for the Pipeline Playground.
// Mirrors the pattern in Editor.tsx but operates on PlaygroundData JSON
// rather than Tiptap doc JSON.

import { useCallback, useEffect, useRef } from "react";

interface UsePlaygroundAutosaveArgs {
  documentId: string;
  tabId: string;
  getContent: () => string;
  onStatusChange: (status: "saved" | "saving" | "unsaved") => void;
  debounceMs?: number;
}

export function usePlaygroundAutosave({
  documentId,
  tabId,
  getContent,
  onStatusChange,
  debounceMs = 1500,
}: UsePlaygroundAutosaveArgs) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const content = getContent();
    onStatusChange("saving");
    try {
      const res = await fetch(
        `/api/documents/${documentId}/tabs/${tabId}/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      if (res.ok) {
        onStatusChange("saved");
      } else {
        onStatusChange("unsaved");
      }
    } catch {
      onStatusChange("unsaved");
    }
  }, [documentId, tabId, getContent, onStatusChange]);

  const scheduleFlush = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onStatusChange("unsaved");
    timeoutRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
  }, [flush, debounceMs, onStatusChange]);

  // Flush on unmount if dirty
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        void flush();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { scheduleFlush, flush };
}
