"use client";

import type { HeadingItem } from "./Editor";

interface Props {
  headings: HeadingItem[];
  onScrollTo: (pos: number) => void;
}

export default function DocumentOutline({ headings, onScrollTo }: Props) {
  if (headings.length === 0) return null;

  return (
    <div className="w-44 flex-shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto flex flex-col">
      <div className="px-3 py-2 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Outline
        </span>
      </div>
      <nav className="py-1">
        {headings.map((heading, i) => {
          const indent =
            heading.level === 1 ? "pl-3" : heading.level === 2 ? "pl-6" : "pl-9";
          const textStyle =
            heading.level === 1
              ? "text-sm font-medium text-gray-800"
              : heading.level === 2
                ? "text-sm text-gray-600"
                : "text-xs text-gray-500";

          return (
            <button
              key={i}
              type="button"
              onClick={() => onScrollTo(heading.pos)}
              className={`block w-full text-left truncate py-1 pr-2 hover:bg-gray-100 hover:text-gray-900 transition-colors ${indent} ${textStyle}`}
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
