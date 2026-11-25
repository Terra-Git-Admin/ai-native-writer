"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface TaxonomySubtype {
  id: string;
  name: string;
  description: string;
  position: number;
  adCount: number;
  seriesCount: number;
}

export interface TaxonomyFamily {
  id: string;
  name: string;
  description: string;
  position: number;
  adCount: number;
  seriesCount: number;
  subtypes: TaxonomySubtype[];
}

type Props = {
  families: TaxonomyFamily[];
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export default function TaxonomyManager({ families, onClose, onChanged }: Props) {
  const [familyId, setFamilyId] = useState(families[0]?.id ?? "");
  const [subtypeId, setSubtypeId] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [familyDescription, setFamilyDescription] = useState("");
  const [subtypeName, setSubtypeName] = useState("");
  const [subtypeDescription, setSubtypeDescription] = useState("");
  const [newFamily, setNewFamily] = useState("");
  const [newSubtype, setNewSubtype] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const family = useMemo(() => families.find((item) => item.id === familyId) ?? null, [families, familyId]);
  const subtype = family?.subtypes.find((item) => item.id === subtypeId) ?? null;

  useEffect(() => {
    if (!family && families[0]) setFamilyId(families[0].id);
  }, [families, family]);
  useEffect(() => {
    setFamilyName(family?.name ?? "");
    setFamilyDescription(family?.description ?? "");
    if (!family?.subtypes.some((item) => item.id === subtypeId)) setSubtypeId("");
  }, [family, subtypeId]);
  useEffect(() => {
    setSubtypeName(subtype?.name ?? "");
    setSubtypeDescription(subtype?.description ?? "");
  }, [subtype]);

  const request = async (method: string, body?: object, query = "") => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/ad-taxonomy${query}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update taxonomy");
      await onChanged();
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update taxonomy");
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="taxonomy-title">
      <button aria-label="Close taxonomy manager" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <section className="relative flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="taxonomy-title" className="text-lg font-semibold">Creative taxonomy</h2>
            <p className="mt-1 text-sm text-muted-foreground">Define Creative Families and the Subtypes used to classify every ad.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-lg p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[260px_1fr]">
          <aside className="overflow-y-auto border-b border-border bg-muted/30 p-4 md:border-b-0 md:border-r">
            <form className="mb-4 flex gap-2" onSubmit={async (event) => {
              event.preventDefault();
              const created = await request("POST", { kind: "family", name: newFamily, description: "" });
              if (created?.id) { setFamilyId(created.id); setNewFamily(""); }
            }}>
              <label className="sr-only" htmlFor="new-family">New Creative Family</label>
              <input id="new-family" value={newFamily} onChange={(event) => setNewFamily(event.target.value)} placeholder="New family" className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
              <button disabled={busy || !newFamily.trim()} aria-label="Add Creative Family" className="min-h-11 min-w-11 rounded-md bg-foreground p-2 text-background disabled:opacity-50"><Plus className="h-4 w-4" /></button>
            </form>
            <div className="space-y-1">
              {families.map((item) => (
                <button key={item.id} onClick={() => setFamilyId(item.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item.id === familyId ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:bg-card hover:text-foreground"}`}>
                  <span className="block truncate">{item.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.adCount} ads · {item.seriesCount} Series</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="overflow-y-auto p-5">
            {!family ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center"><p className="font-medium">Create your first Creative Family</p><p className="mt-1 text-sm text-muted-foreground">The reference list is not seeded; build the taxonomy you want to use.</p></div>
            ) : (
              <div className="space-y-7">
                <section>
                  <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Creative Family</h3><div className="flex gap-1">
                    <button aria-label="Move family up" disabled={busy} onClick={() => request("PATCH", { kind: "family", id: family.id, move: "up" })} className="rounded-md border border-border p-2 hover:bg-muted"><ArrowUp className="h-4 w-4" /></button>
                    <button aria-label="Move family down" disabled={busy} onClick={() => request("PATCH", { kind: "family", id: family.id, move: "down" })} className="rounded-md border border-border p-2 hover:bg-muted"><ArrowDown className="h-4 w-4" /></button>
                    <button aria-label="Delete family" disabled={busy} onClick={() => request("DELETE", undefined, `?kind=family&id=${encodeURIComponent(family.id)}`)} className="rounded-md border border-red-200 p-2 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"><Trash2 className="h-4 w-4" /></button>
                  </div></div>
                  <label className="mt-3 block text-sm font-medium">Name<input value={familyName} onChange={(event) => setFamilyName(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" /></label>
                  <label className="mt-3 block text-sm font-medium">Definition or example execution<textarea value={familyDescription} onChange={(event) => setFamilyDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></label>
                  <button disabled={busy} onClick={() => request("PATCH", { kind: "family", id: family.id, name: familyName, description: familyDescription })} className="mt-3 min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">Save Family</button>
                </section>

                <section className="border-t border-border pt-6">
                  <h3 className="font-semibold">Subtypes</h3>
                  <form className="mt-3 flex gap-2" onSubmit={async (event) => {
                    event.preventDefault();
                    const created = await request("POST", { kind: "subtype", familyId: family.id, name: newSubtype, description: "" });
                    if (created?.id) { setSubtypeId(created.id); setNewSubtype(""); }
                  }}>
                    <label className="sr-only" htmlFor="new-subtype">New Subtype</label>
                    <input id="new-subtype" value={newSubtype} onChange={(event) => setNewSubtype(event.target.value)} placeholder="New subtype" className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" />
                    <button disabled={busy || !newSubtype.trim()} className="min-h-11 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50">Add</button>
                  </form>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {family.subtypes.map((item) => <button key={item.id} onClick={() => setSubtypeId(item.id)} className={`rounded-full border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${subtypeId === item.id ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200" : "border-border hover:bg-muted"}`}>{item.name} <span className="text-muted-foreground">{item.adCount}</span></button>)}
                  </div>
                  {subtype && <div className="mt-4 rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between"><p className="text-sm font-semibold">Edit Subtype</p><div className="flex gap-1">
                      <button aria-label="Move subtype up" onClick={() => request("PATCH", { kind: "subtype", id: subtype.id, move: "up" })} className="rounded-md border border-border p-2"><ArrowUp className="h-4 w-4" /></button>
                      <button aria-label="Move subtype down" onClick={() => request("PATCH", { kind: "subtype", id: subtype.id, move: "down" })} className="rounded-md border border-border p-2"><ArrowDown className="h-4 w-4" /></button>
                      <button aria-label="Delete subtype" onClick={() => request("DELETE", undefined, `?kind=subtype&id=${encodeURIComponent(subtype.id)}`)} className="rounded-md border border-red-200 p-2 text-red-700 dark:border-red-900 dark:text-red-300"><Trash2 className="h-4 w-4" /></button>
                    </div></div>
                    <label className="mt-3 block text-sm font-medium">Name<input value={subtypeName} onChange={(event) => setSubtypeName(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" /></label>
                    <label className="mt-3 block text-sm font-medium">Definition or example execution<textarea value={subtypeDescription} onChange={(event) => setSubtypeDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></label>
                    <button onClick={() => request("PATCH", { kind: "subtype", id: subtype.id, name: subtypeName, description: subtypeDescription })} className="mt-3 min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">Save Subtype</button>
                  </div>}
                </section>
              </div>
            )}
            {message && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{message}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
