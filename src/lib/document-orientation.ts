export const DOCUMENT_ORIENTATIONS = ["portrait", "landscape"] as const;

export type DocumentOrientation = (typeof DOCUMENT_ORIENTATIONS)[number];

export function isDocumentOrientation(value: unknown): value is DocumentOrientation {
  return typeof value === "string" && DOCUMENT_ORIENTATIONS.includes(value as DocumentOrientation);
}

export function parseDocumentOrientation(value: unknown): DocumentOrientation {
  return isDocumentOrientation(value) ? value : "portrait";
}

export function orientationLabel(orientation: DocumentOrientation): string {
  return orientation === "landscape" ? "Landscape" : "Portrait";
}
