"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";

interface Prompt {
  id: string;
  label: string;
  content: string;
  updatedAt: string;
}

interface PromptEditorProps {
  onClose: () => void;
}

export default function PromptEditor({ onClose }: PromptEditorProps) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [promptsList, setPromptsList] = useState<Prompt[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPrompts = useCallback(async () => {
    const res = await fetch("/api/prompts");
    if (res.ok) {
      const data = await res.json();
      setPromptsList(data);
      if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id);
        setEditContent(data[0].content);
      }
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const p = promptsList.find((p) => p.id === id);
    setEditContent(p?.content || "");
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedId || !isAdmin) return;
    setSaving(true);
    await fetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedId, content: editContent }),
    });
    setSaving(false);
    setSaved(true);
    fetchPrompts();
    setTimeout(() => setSaved(false), 2000);
  };

  const selected = promptsList.find((p) => p.id === selectedId);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="font-semibold">Prompts</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg"
        >
          &times;
        </button>
      </div>

      {/* Prompt selector */}
      <div className="border-b border-gray-200 px-4 py-2">
        <select
          value={selectedId || ""}
          onChange={(e) => handleSelect(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm focus:border-indigo-300 focus:outline-none"
        >
          {promptsList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Prompt content — fills remaining height */}
      <div className="flex-1 flex flex-col overflow-hidden p-4">
        {selected && (
          <div className="flex flex-col flex-1 gap-2 min-h-0">
            <div className="flex items-center justify-between shrink-0">
              <p className="text-xs text-gray-500">
                {isAdmin ? "Edit prompt below" : "Read-only — only admins can edit"}
              </p>
              {saved && (
                <span className="text-xs text-green-600 font-medium">
                  Saved
                </span>
              )}
            </div>
            <textarea
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setSaved(false);
              }}
              readOnly={!isAdmin}
              className={`w-full flex-1 resize-none rounded-lg border px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none ${
                isAdmin
                  ? "border-gray-300 bg-white focus:border-indigo-400"
                  : "border-gray-200 bg-gray-50 text-gray-600 cursor-default"
              }`}
            />
          </div>
        )}
      </div>

      {/* Save button (admin only) */}
      {isAdmin && (
        <div className="border-t border-gray-200 p-3">
          <button
            onClick={handleSave}
            disabled={saving || !selectedId}
            className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Prompt"}
          </button>
        </div>
      )}
    </div>
  );
}
