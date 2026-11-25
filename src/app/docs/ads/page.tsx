"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import LibraryModeSwitch from "@/components/documents/LibraryModeSwitch";
import type { TaxonomyFamily } from "@/components/ads/TaxonomyManager";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { isAdsLibraryEnabledForClient } from "@/lib/ads-library-flags";
import { isPitchLabEnabledForClient } from "@/lib/pitch-lab-flags";

type AdSummary = {
  documentId: string;
  sectionUid: string;
  tabId: string;
  title: string;
  excerpt: string;
  seriesTitle: string;
  ownerName: string | null;
  archived: boolean;
  updatedAt: string;
  familyId: string | null;
  familyName: string | null;
  subtypeId: string | null;
  subtypeName: string | null;
};
type AdPreview = AdSummary & { plainText: string };
type CatalogResponse = {
  ads: AdSummary[];
  families: TaxonomyFamily[];
  series: Array<{ id: string; title: string; archived: boolean }>;
  totals: { all: number; filtered: number; unclassified: number };
  diagnostics: { missingUidCount: number };
};

const emptyCatalog: CatalogResponse = { ads: [], families: [], series: [], totals: { all: 0, filtered: 0, unclassified: 0 }, diagnostics: { missingUidCount: 0 } };
const adKey = (ad: Pick<AdSummary, "documentId" | "sectionUid">) => `${ad.documentId}:${ad.sectionUid}`;

export default function AdsLibraryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const enabled = isAdsLibraryEnabledForClient();
  const pitchLabEnabled = isPitchLabEnabledForClient();
  const [catalog, setCatalog] = useState<CatalogResponse>(emptyCatalog);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [assignFamilyId, setAssignFamilyId] = useState("");
  const [assignSubtypeId, setAssignSubtypeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated" || !enabled) router.replace("/docs");
    if (status === "authenticated" && session?.user?.role !== "admin") router.replace("/docs");
  }, [enabled, router, session?.user?.role, status]);

  const load = useCallback(async () => {
    if (status !== "authenticated" || session?.user?.role !== "admin" || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ads");
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not load the Ads Library");
      setCatalog(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the Ads Library");
    } finally {
      setLoading(false);
    }
  }, [enabled, session?.user?.role, status]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const openPreview = async (ad: AdSummary) => {
    const key = adKey(ad);
    setPreviewKey(key);
    setPreviewLoading(true);
    setAssignFamilyId(ad.familyId ?? "");
    setAssignSubtypeId(ad.subtypeId ?? "");
    try {
      const response = await fetch(`/api/ads/${encodeURIComponent(ad.documentId)}/${encodeURIComponent(ad.sectionUid)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not load this ad");
      setPreview(data);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not load this ad");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };
  const classify = async (ads: Array<Pick<AdSummary, "documentId" | "sectionUid">>, clear = false) => {
    if (!clear && (!assignFamilyId || !assignSubtypeId)) { setNotice("Choose both a Creative Family and Subtype"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/ads/classifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ads: ads.map(({ documentId, sectionUid }) => ({ documentId, sectionUid })), familyId: assignFamilyId, subtypeId: assignSubtypeId, clear }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not classify ads");
      setNotice(clear ? "Classification cleared" : `${ads.length} ad${ads.length === 1 ? "" : "s"} classified`);
      await load();
      if (preview) await openPreview(preview);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not classify ads");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || !session?.user || session.user.role !== "admin" || !enabled) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;

  return <div className="min-h-screen bg-background">
    <header className="border-b border-border bg-card"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-4 sm:px-6">
      <Link href="/" className="text-xl font-bold">AI Writer</Link>
      <nav aria-label="Primary navigation" className="ml-4 flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground">Home</Link>
        {pitchLabEnabled && <Link href="/pitch-lab" className="text-muted-foreground hover:text-foreground">Pitch Lab</Link>}
        <ThemeToggle /><Link href="/admin" className="text-muted-foreground hover:text-foreground">Admin</Link>
        <span className="hidden md:inline">{session.user.name}</span><button onClick={() => signOut()} className="text-muted-foreground hover:text-foreground">Sign out</button>
      </nav>
    </div></header>

    <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-medium text-indigo-600">Library</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">All Ads</h1><p className="mt-1 text-sm text-muted-foreground">{catalog.totals.all} ads across {catalog.series.length} Series</p></div>
        <LibraryModeSwitch active="ads" />
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error} <button onClick={() => void load()} className="ml-2 underline">Retry</button></div>}
      {catalog.diagnostics.missingUidCount > 0 && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">{catalog.diagnostics.missingUidCount} existing ads need the UID backfill before they can appear here.</div>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        <section className="min-w-0">
          <p className="mb-2 text-sm text-muted-foreground"><span className="font-medium text-foreground">{catalog.totals.all}</span> ads</p>
          {loading ? <div className="space-y-2">{[1,2,3,4].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div> : catalog.ads.length === 0 ? <EmptyState /> : <div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[minmax(180px,1.5fr)_minmax(130px,1fr)_minmax(110px,.8fr)_minmax(120px,1fr)_minmax(120px,1fr)] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid"><span>Ad</span><span>Series</span><span>Owner</span><span>Family</span><span>Subtype</span></div>{catalog.ads.map((ad) => <AdRow key={adKey(ad)} ad={ad} active={previewKey === adKey(ad)} onOpen={() => void openPreview(ad)} />)}</div>}
        </section>
        <PreviewPanel ad={preview} loading={previewLoading} open={Boolean(previewKey || previewLoading)} families={catalog.families} familyId={assignFamilyId} subtypeId={assignSubtypeId} onFamily={(value) => { setAssignFamilyId(value); setAssignSubtypeId(""); }} onSubtype={setAssignSubtypeId} onSave={() => { if (preview) void classify([preview]); }} onClear={() => { if (preview) void classify([preview], true); }} onClose={() => { setPreviewKey(null); setPreview(null); }} saving={saving} />
      </div>
    </main>

    {notice && <p role="status" className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-xl">{notice}</p>}
  </div>;
}

function AdRow({ ad, active, onOpen }: { ad: AdSummary; active: boolean; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className={`grid w-full grid-cols-1 gap-1 border-b border-border px-4 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:grid-cols-[minmax(180px,1.5fr)_minmax(130px,1fr)_minmax(110px,.8fr)_minmax(120px,1fr)_minmax(120px,1fr)] md:items-center md:gap-3 ${active ? "bg-indigo-50/70 dark:bg-indigo-950/20" : "hover:bg-muted/40"}`}>
    <span className="min-w-0"><span className="block truncate text-sm font-medium">{ad.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{ad.excerpt || "No preview text"}</span></span>
    <span className="truncate text-sm"><span className="mr-1 text-xs text-muted-foreground md:hidden">Series:</span>{ad.seriesTitle}</span>
    <span className="truncate text-sm"><span className="mr-1 text-xs text-muted-foreground md:hidden">Owner:</span>{ad.ownerName || "Unassigned"}</span>
    <span className={`truncate text-sm ${ad.familyName ? "" : "text-amber-700 dark:text-amber-300"}`}><span className="mr-1 text-xs text-muted-foreground md:hidden">Family:</span>{ad.familyName || "Unclassified"}</span>
    <span className="truncate text-sm text-muted-foreground"><span className="mr-1 text-xs md:hidden">Subtype:</span>{ad.subtypeName || "—"}</span>
  </button>;
}

function ClassificationFields({ families, familyId, subtypeId, onFamily, onSubtype }: { families: TaxonomyFamily[]; familyId: string; subtypeId: string; onFamily: (value: string) => void; onSubtype: (value: string) => void }) {
  const family = families.find((item) => item.id === familyId);
  return <><label className="block text-xs font-medium text-muted-foreground">Creative Family<select value={familyId} onChange={(event) => onFamily(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"><option value="">Choose Family</option>{families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-xs font-medium text-muted-foreground">Subtype<select value={subtypeId} onChange={(event) => onSubtype(event.target.value)} disabled={!family} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50"><option value="">Choose Subtype</option>{family?.subtypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>;
}

function PreviewPanel({ ad, loading, open, families, familyId, subtypeId, onFamily, onSubtype, onSave, onClear, onClose, saving }: { ad: AdPreview | null; loading: boolean; open: boolean; families: TaxonomyFamily[]; familyId: string; subtypeId: string; onFamily: (v: string) => void; onSubtype: (v: string) => void; onSave: () => void; onClear: () => void; onClose: () => void; saving: boolean }) {
  return <aside aria-label="Ad reader" className={`${open ? "fixed inset-0 z-50" : "hidden"} flex flex-col border border-border bg-background shadow-xl lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-2rem)] lg:rounded-xl`}>
    {!open ? <div className="flex h-full flex-col items-center justify-center px-8 text-center"><p className="font-medium">Select an ad to read it</p><p className="mt-2 text-sm leading-6 text-muted-foreground">The full ad, its Series link, and classification controls will stay here while you browse.</p></div> : <>
      <header className="flex items-start gap-3 border-b border-border p-5"><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Ad reader</p><h2 id="preview-title" className="mt-1 truncate text-lg font-semibold">{ad?.title || "Loading…"}</h2><p className="mt-1 truncate text-sm text-muted-foreground">{ad?.seriesTitle}</p>{ad && <p className="mt-1 truncate text-xs text-muted-foreground">Owner: <span className="font-medium text-foreground">{ad.ownerName || "Unassigned"}</span> · Source edits happen in Series</p>}</div>{ad && <Link href={`/doc/${ad.documentId}?tab=${encodeURIComponent(ad.tabId)}&section=${encodeURIComponent(ad.sectionUid)}`} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Open in Series <ExternalLink className="h-4 w-4" /></Link>}<button onClick={onClose} aria-label="Close reader" className="min-h-10 min-w-10 rounded-md p-2 hover:bg-muted"><X className="h-5 w-5" /></button></header>
      {loading || !ad ? <div className="p-5 text-sm text-muted-foreground">Loading preview…</div> : <><div className="min-h-0 flex-1 overflow-y-auto p-5"><pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-foreground">{ad.plainText}</pre></div><footer className="space-y-3 border-t border-border bg-card p-5"><div className="grid gap-2 sm:grid-cols-2"><ClassificationFields families={families} familyId={familyId} subtypeId={subtypeId} onFamily={onFamily} onSubtype={onSubtype} /></div><div className="flex flex-wrap gap-2"><button disabled={saving || !familyId || !subtypeId} onClick={onSave} className="min-h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50">Save classification</button><button disabled={saving || !ad.familyId} onClick={onClear} className="min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50">Clear</button></div></footer></>}
    </>}
  </aside>;
}

function EmptyState() {
  return <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center"><h2 className="font-semibold">No ads yet</h2><p className="mt-2 text-sm text-muted-foreground">Ads will appear here from each Series Ads tab.</p></div>;
}
