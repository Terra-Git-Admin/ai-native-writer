"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";

type PlaybackState = "idle" | "generating" | "playing";

interface TextToSpeechButtonProps {
  getText: () => string;
  cancelKey: string | null;
}

function buildChunks(text: string): string[] {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?\n]+[.!?]+["')\]]*|[^\n]+|\n+/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const trimmed = sentence.replace(/[ \t]+/g, " ").trim();
    if (!trimmed) continue;

    if (!current) {
      current = trimmed;
    } else if (`${current}\n${trimmed}`.length <= 3200) {
      current = `${current}\n${trimmed}`;
    } else {
      chunks.push(current);
      current = trimmed;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function playAudio(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Audio playback failed"));
    audio.play().catch(reject);
  });
}

export default function TextToSpeechButton({
  getText,
  cancelKey,
}: TextToSpeechButtonProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [chunkIndex, setChunkIndex] = useState(0);
  const [chunkTotal, setChunkTotal] = useState(0);
  const [message, setMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);

  const stopPlayback = useCallback((resetUi = true) => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current.load();
      audioRef.current = null;
    }

    if (!resetUi) return;
    setPlaybackState("idle");
    setChunkIndex(0);
    setChunkTotal(0);
    setMessage("");
  }, []);

  useEffect(() => {
    return () => stopPlayback(false);
  }, [stopPlayback]);

  useEffect(() => {
    stopPlayback();
  }, [cancelKey, stopPlayback]);

  const startPlayback = useCallback(async () => {
    const chunks = buildChunks(getText());
    if (chunks.length === 0) {
      setMessage("Nothing to read");
      return;
    }

    stopPlayback();
    cancelledRef.current = false;
    setChunkTotal(chunks.length);
    setPlaybackState("generating");

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        if (cancelledRef.current) return;

        setChunkIndex(index + 1);
        setMessage(`Generating ${index + 1}/${chunks.length}`);
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await fetch("/api/tts/gemini", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: chunks[index] }),
          signal: controller.signal,
        });

        abortRef.current = null;

        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error.error || "Gemini TTS failed");
        }

        const data = (await res.json()) as { audioDataUrl?: string };
        if (!data.audioDataUrl) {
          throw new Error("Gemini returned no audio");
        }

        if (cancelledRef.current) return;

        setPlaybackState("playing");
        setMessage(`Playing ${index + 1}/${chunks.length}`);
        const audio = new Audio(data.audioDataUrl);
        audioRef.current = audio;
        await playAudio(audio);
        audioRef.current = null;
        setPlaybackState("generating");
      }

      setPlaybackState("idle");
      setChunkIndex(0);
      setChunkTotal(0);
      setMessage("");
    } catch (error) {
      if (cancelledRef.current) return;
      setPlaybackState("idle");
      setMessage(error instanceof Error ? error.message : "Gemini TTS failed");
    }
  }, [getText, stopPlayback]);

  const active = playbackState !== "idle";
  const progress = useMemo(() => {
    if (!chunkTotal) return 0;
    return Math.min(100, Math.round((chunkIndex / chunkTotal) * 100));
  }, [chunkIndex, chunkTotal]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={active ? () => stopPlayback() : startPlayback}
        aria-pressed={active}
        aria-label={active ? "Stop Gemini text to speech" : "Listen with Gemini text to speech"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-background ${
          active
            ? "bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70"
            : "text-muted-foreground hover:bg-muted"
        }`}
      >
        {playbackState === "generating" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : active ? (
          <Square className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
        {active ? "Stop" : "Listen"}
      </button>
      <div className="w-28" aria-live="polite">
        {message ? (
          <>
            <div className="truncate text-xs text-muted-foreground">{message}</div>
            {active && (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-sky-500 transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
