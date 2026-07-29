"use client";

import { memo, useCallback, useRef } from "react";
import type { PlaygroundBeat } from "@/lib/ai/playground-beats";

// ─── Lock icons ───────────────────────────────────────────────────────────────

function LockClosedIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LockOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

// ─── Beat row ─────────────────────────────────────────────────────────────────

interface BeatRowProps {
  beat: PlaygroundBeat;
  onTextChange: (id: string, text: string) => void;
  onToggleLock: (id: string) => void;
  disabled: boolean;
}

function BeatRow({ beat, onTextChange, onToggleLock, disabled }: BeatRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onTextChange(beat.id, e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    },
    [beat.id, onTextChange]
  );

  const handleToggle = useCallback(() => {
    onToggleLock(beat.id);
  }, [beat.id, onToggleLock]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleLock(beat.id);
      }
    },
    [beat.id, onToggleLock]
  );

  return (
    <div
      className={`group relative flex items-start gap-2 rounded-md px-3 py-2 transition-all duration-200
        ${beat.locked
          ? "bg-emerald-500/10 dark:bg-emerald-500/15 border-l-2 border-emerald-500"
          : "border-l-2 border-transparent opacity-60 hover:opacity-80"
        }`}
    >
      <textarea
        ref={textareaRef}
        value={beat.text}
        onChange={handleInput}
        disabled={disabled}
        rows={1}
        className={`flex-1 resize-none overflow-hidden bg-transparent text-sm leading-relaxed outline-none
          placeholder:text-muted-foreground disabled:cursor-not-allowed
          ${beat.locked ? "text-foreground" : "text-muted-foreground"}`}
        style={{ minHeight: "1.5rem" }}
        aria-label={`Beat: ${beat.text.slice(0, 40)}`}
      />
      <button
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={beat.locked ? "Unlock beat" : "Lock beat"}
        aria-pressed={beat.locked}
        className={`flex-shrink-0 flex items-center justify-center w-[44px] h-[44px] rounded
          transition-colors duration-150 cursor-pointer
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
          disabled:cursor-not-allowed disabled:opacity-40
          ${beat.locked
            ? "text-emerald-500 hover:text-emerald-400"
            : "text-muted-foreground hover:text-foreground"
          }`}
      >
        {beat.locked
          ? <LockClosedIcon className="w-4 h-4" />
          : <LockOpenIcon className="w-4 h-4" />
        }
      </button>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PlaygroundBeatsBlockProps {
  beats: PlaygroundBeat[];
  onTextChange: (id: string, text: string) => void;
  onToggleLock: (id: string) => void;
  isStreaming: boolean;
}

function PlaygroundBeatsBlock({
  beats,
  onTextChange,
  onToggleLock,
  isStreaming,
}: PlaygroundBeatsBlockProps) {
  const lockedCount = beats.filter((b) => b.locked).length;
  const totalCount = beats.length;

  // Group beats by batch for rendering
  const groups: Array<{ batch: string | undefined; beats: PlaygroundBeat[] }> = [];
  for (const beat of beats) {
    const last = groups[groups.length - 1];
    if (!last || last.batch !== beat.batch) {
      groups.push({ batch: beat.batch, beats: [beat] });
    } else {
      last.beats.push(beat);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">Beats</h3>
        {totalCount > 0 && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-200
              ${lockedCount > 0
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
              }`}
          >
            {lockedCount} / {totalCount} locked
          </span>
        )}
      </header>

      <div className="px-1 py-2 min-h-[120px]">
        {groups.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground italic">
            Beats will auto-populate from the Beats tab when you open Playground.
          </p>
        ) : (
          groups.map((group, gi) => (
            <div key={`group-${gi}-${group.batch ?? "root"}`}>
              {group.batch && (
                <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none">
                    {group.batch}
                  </span>
                  <div className="flex-1 h-px bg-border/50" />
                </div>
              )}
              {group.beats.map((beat) => (
                <BeatRow
                  key={beat.id}
                  beat={beat}
                  onTextChange={onTextChange}
                  onToggleLock={onToggleLock}
                  disabled={isStreaming}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default memo(PlaygroundBeatsBlock);
