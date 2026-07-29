"use client";

import type { HeadingItem } from "./Editor";

interface Props {
  headings: HeadingItem[];
  onScrollTo: (pos: number) => void;
}

export default function DocumentOutline({ headings, onScrollTo }: Props) {
  if (headings.length === 0) return null;

  return (
    <div className="w-44 flex-shrink-0 border-r border-border bg-muted overflow-y-auto flex flex-col">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Outline
        </span>
      </div>
      <nav className="py-1">
        {headings.map((heading, i) => {
          const indent =
            heading.level === 1 ? "pl-3" : heading.level === 2 ? "pl-6" : "pl-9";
          const textStyle =
            heading.level === 1
              ? "text-sm font-medium text-foreground"
              : heading.level === 2
                ? "text-sm text-muted-foreground"
                : "text-xs text-muted-foreground";

          return (
            <button
              key={i}
              type="button"
              onClick={() => onScrollTo(heading.pos)}
              className={`block w-full text-left truncate py-1 pr-2 hover:bg-muted hover:text-foreground transition-colors ${indent} ${textStyle}`}
              title={heading.text}
            >
              {heading.text}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
