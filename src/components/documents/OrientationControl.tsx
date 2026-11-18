"use client";

import type { DocumentOrientation } from "@/lib/document-orientation";

export function OrientationBadge({ orientation }: { orientation: DocumentOrientation }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {orientation === "landscape" ? "Landscape" : "Portrait"}
    </span>
  );
}

export function OrientationSelect({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Document format",
}: {
  value: DocumentOrientation;
  onChange: (value: DocumentOrientation) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as DocumentOrientation)}
      className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-60"
    >
      <option value="portrait">Portrait</option>
      <option value="landscape">Landscape</option>
    </select>
  );
}
