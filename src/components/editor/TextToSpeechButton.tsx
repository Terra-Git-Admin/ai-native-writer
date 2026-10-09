"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { extractEpisodeSections, type EpisodeSection } from "@/lib/editor/episode-sections";

type PlaybackState = "idle" | "generating" | "playing";

interface TextToSpeechButtonProps {
  getContentJSON: () => string | null;
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

function episodeCacheKey(cancelKey: string | null, episode: EpisodeSection): string {
  return `${cancelKey ?? "tab"}:${episode.index}:${episode.contentHash}`;
}

function compactEpisodeLabel(episode: EpisodeSection): string {
  return `Ep ${episode.index}`;
}

export default function TextToSpeechButton({
  getContentJSON,
  cancelKey,
}: TextToSpeechButtonProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [chunkIndex, setChunkIndex] = useState(0);
  const [chunkTotal, setChunkTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeSection[]>([]);
  const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState<number | null>(null);
  const getContentJSONRef = useRef(getContentJSON);
  const selectedEpisodeIndexRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelledRef = useRef(false);
  const audioCacheRef = useRef<Map<string, string[]>>(new Map());

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

  const refreshEpisodes = useCallback(
    (preferLatest: boolean) => {
      const nextEpisodes = extractEpisodeSections(getContentJSONRef.current());
      setEpisodes(nextEpisodes);

      const currentSelected = selectedEpisodeIndexRef.current;
      const hasSelected = nextEpisodes.some((episode) => episode.index === currentSelected);
      if (preferLatest || !hasSelected) {
        setSelectedEpisodeIndex(
          nextEpisodes.length > 0 ? nextEpisodes[nextEpisodes.length - 1].index : null
        );
      }

      return nextEpisodes;
    },
    []
  );

  useEffect(() => {
    getContentJSONRef.current = getContentJSON;
  }, [getContentJSON]);

  useEffect(() => {
    selectedEpisodeIndexRef.current = selectedEpisodeIndex;
  }, [selectedEpisodeIndex]);

  useEffect(() => {
    return () => stopPlayback(false);
  }, [stopPlayback]);

  useEffect(() => {
    stopPlayback();
    audioCacheRef.current.clear();
    refreshEpisodes(true);
  }, [cancelKey, refreshEpisodes, stopPlayback]);

  const playAudioUrls = useCallback(async (
    audioUrls: string[],
    fromCache: boolean,
    total = audioUrls.length,
    offset = 0
  ) => {
    setChunkTotal(total);
    setPlaybackState("playing");

    for (let index = 0; index < audioUrls.length; index += 1) {
      if (cancelledRef.current) return;

      const displayIndex = offset + index + 1;
      setChunkIndex(displayIndex);
      setMessage(`${fromCache ? "Playing cached" : "Playing"} ${displayIndex}/${total}`);
      const audio = new Audio(audioUrls[index]);
      audioRef.current = audio;
      await playAudio(audio);
      audioRef.current = null;
    }
  }, []);

  const startPlayback = useCallback(async () => {
    const latestEpisodes = refreshEpisodes(false);
    const selectedEpisode =
      latestEpisodes.find((episode) => episode.index === selectedEpisodeIndex) ??
      latestEpisodes[latestEpisodes.length - 1];

    if (!selectedEpisode) {
      setMessage("No episodes found");
      return;
    }

    const chunks = buildChunks(selectedEpisode.text);
    if (chunks.length === 0) {
      setMessage("Nothing to read");
      return;
    }

    stopPlayback();
    cancelledRef.current = false;
    setChunkTotal(chunks.length);
    setPlaybackState("generating");

    const cacheKey = episodeCacheKey(cancelKey, selectedEpisode);
    const cachedAudioUrls = audioCacheRef.current.get(cacheKey);

    try {
      if (cachedAudioUrls) {
        setMessage("Ready");
        await playAudioUrls(cachedAudioUrls, true);
      } else {
        const generatedAudioUrls: string[] = [];

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

          generatedAudioUrls.push(data.audioDataUrl);
          await playAudioUrls([data.audioDataUrl], false, chunks.length, index);
          setPlaybackState("generating");
        }

        if (!cancelledRef.current) {
          audioCacheRef.current.set(cacheKey, generatedAudioUrls);
        }
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
  }, [
    cancelKey,
    playAudioUrls,
    refreshEpisodes,
    selectedEpisodeIndex,
    stopPlayback,
  ]);

  const active = playbackState !== "idle";
  const progress = useMemo(() => {
    if (!chunkTotal) return 0;
    return Math.min(100, Math.round((chunkIndex / chunkTotal) * 100));
  }, [chunkIndex, chunkTotal]);
  const selectedEpisode = episodes.find((episode) => episode.index === selectedEpisodeIndex);
  const noEpisodes = episodes.length === 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-border bg-background/70">
        {episodes.length > 1 && (
          <label className="sr-only" htmlFor="tts-episode-select">
            Episode to listen to
          </label>
        )}
        {episodes.length > 1 && (
          <select
            id="tts-episode-select"
            value={selectedEpisodeIndex ?? ""}
            disabled={active}
            title={selectedEpisode?.label ?? "Episode to listen to"}
            aria-label={
              selectedEpisode
                ? `Episode to listen to: ${selectedEpisode.label}`
                : "Episode to listen to"
            }
            onFocus={() => refreshEpisodes(false)}
            onPointerDown={() => refreshEpisodes(false)}
            onChange={(event) => {
              stopPlayback();
              setSelectedEpisodeIndex(Number(event.target.value));
              setMessage("");
            }}
            className="w-20 rounded-l-lg border-0 bg-transparent px-2 py-1.5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            {episodes.map((episode) => (
              <option
                key={`${episode.index}-${episode.contentHash}`}
                value={episode.index}
                title={episode.label}
                className="bg-white text-slate-950"
              >
                {compactEpisodeLabel(episode)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={active ? () => stopPlayback() : startPlayback}
          aria-pressed={active}
          aria-label={
            active
              ? "Stop Gemini text to speech"
              : selectedEpisode
                ? `Listen to ${selectedEpisode.label} with Gemini text to speech`
                : "No predefined episodes available to listen to"
          }
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            episodes.length > 1 ? "rounded-r-lg border-l border-border" : "rounded-lg"
          } ${
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
      </div>
      <div className="w-32" aria-live="polite">
        {message || noEpisodes ? (
          <>
            <div className="truncate text-xs text-muted-foreground">
              {message || "No episodes found"}
            </div>
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
