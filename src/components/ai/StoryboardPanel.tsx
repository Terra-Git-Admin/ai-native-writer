"use client";

import { useEffect, useState } from "react";

interface StoryboardFrame {
  beatIndex: number;
  beatText: string;
  prompt: string;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

interface StoryboardData {
  episodeTitle: string;
  storyboard: StoryboardFrame[];
}

interface StoryboardPanelProps {
  documentId: string;
  episodeIndex?: number;
  onClose: () => void;
}

export default function StoryboardPanel({
  documentId,
  episodeIndex,
  onClose,
}: StoryboardPanelProps) {
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [data, setData] = useState<StoryboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("loading");
    setData(null);
    setError(null);

    fetch(`/api/documents/${documentId}/visualize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(episodeIndex != null ? { episodeIndex } : {}),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Server returned ${res.status}`);
        }
        return res.json() as Promise<StoryboardData>;
      })
      .then((d) => {
        setData(d);
        setStatus("done");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Storyboard generation failed.");
        setStatus("error");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, episodeIndex]);

  const successCount = data?.storyboard.filter((f) => f.imageBase64).length ?? 0;
  const totalCount = data?.storyboard.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 shrink-0">
        <div>
          <h3 className="font-semibold text-indigo-700">Storyboard</h3>
          {data?.episodeTitle && (
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">
              {data.episodeTitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === "done" && (
            <span className="text-[10px] text-gray-400">
              {successCount}/{totalCount} beats
            </span>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === "loading" && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-6">
            <div className="flex gap-1.5">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
            <p className="text-sm text-gray-500 text-center">
              Generating storyboard…
              <br />
              <span className="text-xs text-gray-400">
                This takes 20–40 seconds for a full episode.
              </span>
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {status === "done" && data && (
          <div className="divide-y divide-gray-100">
            {data.storyboard.map((frame) => (
              <div key={frame.beatIndex} className="p-4 space-y-2">
                {/* Beat label + text */}
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                    Beat {frame.beatIndex + 1}
                  </span>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    {frame.beatText}
                  </p>
                </div>

                {/* Image */}
                {frame.imageBase64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:${frame.mimeType ?? "image/png"};base64,${frame.imageBase64}`}
                    alt={`Beat ${frame.beatIndex + 1}`}
                    className="w-full rounded-md"
                  />
                ) : (
                  <div className="flex items-center justify-center rounded-md bg-gray-100 py-6 text-xs text-gray-400">
                    {frame.error ?? "Image generation failed"}
                  </div>
                )}

                {/* Synthesized prompt */}
                {frame.prompt && (
                  <p className="text-[10px] text-gray-400 italic leading-relaxed">
                    {frame.prompt}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
