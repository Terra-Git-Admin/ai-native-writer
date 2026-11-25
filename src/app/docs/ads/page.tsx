"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ExternalLink, Search, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import LibraryModeSwitch from "@/components/documents/LibraryModeSwitch";
import TaxonomyManager, { type TaxonomyFamily } from "@/components/ads/TaxonomyManager";
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
  const [query, setQuery] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [subtypeId, setSubtypeId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [unclassified, setUnclassified] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState("updated");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [assignFamilyId, setAssignFamilyId] = useState("");
  const [assignSubtypeId, setAssignSubtypeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") || "");
    setFamilyId(params.get("familyId") || "");
    setSubtypeId(params.get("subtypeId") || "");
    setSeriesId(params.get("seriesId") || "");
    setUnclassified(params.get("status") === "unclassified");
    setIncludeArchived(params.get("includeArchived") === "true");
    setSort(params.get("sort") || "updated");
    setFiltersReady(true);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated" || !enabled) router.replace("/docs");
    if (status === "authenticated" && session?.user?.role !== "admin") router.replace("/docs");
  }, [enabled, router, session?.user?.role, status]);

  const load = useCallback(async () => {
    if (!filtersReady || status !== "authenticated" || session?.user?.role !== "admin" || !enabled) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (familyId) params.set("familyId", familyId);
    if (subtypeId) params.set("subtypeId", subtypeId);
    if (seriesId) params.set("seriesId", seriesId);
    if (unclassified) params.set("status", "unclassified");
    if (includeArchived) params.set("includeArchived", "true");
    params.set("sort", sort);
    try {
      const response = await fetch(`/api/ads?${params.toString()}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not load the Ads Library");
      setCatalog(data);
      const url = new URL(window.location.href);
      for (const key of ["q", "familyId", "subtypeId", "seriesId", "status", "includeArchived", "sort"]) url.searchParams.delete(key);
      params.forEach((value, key) => url.searchParams.set(key, value));
      window.history.replaceState({}, "", url.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the Ads Library");
    } finally {
      setLoading(false);
    }
  }, [enabled, familyId, filtersReady, includeArchived, query, seriesId, session?.user?.role, sort, status, subtypeId, unclassified]);

  useEffect(() => {
    if (!filtersReady) return;
    const timeout = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(timeout);
  }, [filtersReady, load]);
  useEffect(() => {
    setSelected(new Set());
  }, [familyId, includeArchived, query, seriesId, subtypeId, unclassified]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const activeFamily = catalog.families.find((family) => family.id === familyId) ?? null;
  const groupedAds = useMemo(() => {
    if (!activeFamily) return [{ id: "all", name: unclassified ? "Unclassified" : "All Ads", ads: catalog.ads }];
    return activeFamily.subtypes.map((subtype) => ({ id: subtype.id, name: subtype.name, ads: catalog.ads.filter((ad) => ad.subtypeId === subtype.id) })).filter((group) => group.ads.length > 0);
  }, [activeFamily, catalog.ads, unclassified]);
  const selectedAds = catalog.ads.filter((ad) => selected.has(adKey(ad)));

  const chooseFamily = (next: string) => {
    setFamilyId(next);
    setSubtypeId("");
    setUnclassified(false);
  };
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
      setSelected(new Set());
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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1"><span className="sr-only">Search ads</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ads or Series…" className="min-h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" /></label>
        <select aria-label="Filter by Series" value={seriesId} onChange={(event) => setSeriesId(event.target.value)} className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"><option value="">All Series</option>{catalog.series.map((series) => <option key={series.id} value={series.id}>{series.title}{series.archived ? " (Archived)" : ""}</option>)}</select>
        <select aria-label="Sort ads" value={sort} onChange={(event) => setSort(event.target.value)} className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm"><option value="updated">Recently updated</option><option value="family">Creative Family</option><option value="series">Series</option><option value="ad">Ad name</option></select>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Include archived</label>
        <button onClick={() => setTaxonomyOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"><Settings2 className="h-4 w-4" />Manage Taxonomy</button>
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error} <button onClick={() => void load()} className="ml-2 underline">Retry</button></div>}
      {catalog.diagnostics.missingUidCount > 0 && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">{catalog.diagnostics.missingUidCount} existing ads need the UID backfill before they can appear here.</div>}

      <div className="mt-5 grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside aria-label="Creative Families" className="rounded-xl border border-border bg-card p-3 lg:sticky lg:top-4 lg:self-start">
          <label className="mb-3 block lg:hidden"><span className="mb-1 block text-xs font-medium text-muted-foreground">Creative Family</span><select value={unclassified ? "unclassified" : familyId} onChange={(event) => event.target.value === "unclassified" ? (setUnclassified(true), setFamilyId(""), setSubtypeId("")) : chooseFamily(event.target.value)} className="min-h-11 w-full rounded-md border border-border bg-background px-3"><option value="">All Ads</option><option value="unclassified">Unclassified ({catalog.totals.unclassified})</option>{catalog.families.map((family) => <option key={family.id} value={family.id}>{family.name} ({family.adCount})</option>)}</select></label>
          <div className="hidden space-y-1 lg:block">
            <FamilyButton active={!familyId && !unclassified} label="All Ads" count={catalog.totals.all} onClick={() => { setFamilyId(""); setSubtypeId(""); setUnclassified(false); }} />
            <FamilyButton active={unclassified} label="Unclassified" count={catalog.totals.unclassified} onClick={() => { setFamilyId(""); setSubtypeId(""); setUnclassified(true); }} />
            <div className="my-3 border-t border-border" />
            {catalog.families.map((family) => <div key={family.id}><FamilyButton active={familyId === family.id && !subtypeId} label={family.name} count={family.adCount} meta={`${family.seriesCount} Series`} onClick={() => chooseFamily(family.id)} />{familyId === family.id && <div className="ml-3 mt-1 space-y-1 border-l border-border pl-2">{family.subtypes.map((subtype) => <FamilyButton key={subtype.id} active={subtypeId === subtype.id} label={subtype.name} count={subtype.adCount} onClick={() => setSubtypeId(subtype.id)} compact />)}</div>}</div>)}
          </div>
        </aside>

        <section className="min-w-0">
          {activeFamily && <div className="mb-4 rounded-xl border border-border bg-card px-5 py-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{activeFamily.name}</h2><span className="text-sm text-muted-foreground">{activeFamily.adCount} ads · {activeFamily.seriesCount} Series</span></div>{activeFamily.description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{activeFamily.description}</p>}</div>}
          {selected.size > 0 && <AssignmentBar count={selected.size} families={catalog.families} familyId={assignFamilyId} subtypeId={assignSubtypeId} onFamily={(value) => { setAssignFamilyId(value); setAssignSubtypeId(""); }} onSubtype={setAssignSubtypeId} onApply={() => void classify(selectedAds)} onClear={() => void classify(selectedAds, true)} onCancel={() => setSelected(new Set())} saving={saving} />}
          {loading ? <div className="space-y-2">{[1,2,3,4].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div> : catalog.ads.length === 0 ? <EmptyState hasTaxonomy={catalog.families.length > 0} onManage={() => setTaxonomyOpen(true)} onReset={() => { setQuery(""); setFamilyId(""); setSubtypeId(""); setSeriesId(""); setUnclassified(false); }} /> : <div className="space-y-6">{groupedAds.map((group) => <section key={group.id} aria-labelledby={`group-${group.id}`}>{activeFamily && <div className="mb-2 flex items-center gap-2"><h3 id={`group-${group.id}`} className="font-semibold">{group.name}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{group.ads.length}</span></div>}<div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[40px_minmax(200px,1.5fr)_minmax(160px,1fr)_minmax(150px,1fr)_110px] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid"><span /><span>Ad</span><span>Series</span><span>Classification</span><span>Updated</span></div>{group.ads.map((ad) => <AdRow key={adKey(ad)} ad={ad} checked={selected.has(adKey(ad))} active={previewKey === adKey(ad)} onCheck={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(adKey(ad)); else next.delete(adKey(ad)); return next; })} onOpen={() => void openPreview(ad)} />)}</div></section>)}</div>}
        </section>
      </div>
    </main>

    {(previewKey || previewLoading) && <PreviewPanel ad={preview} loading={previewLoading} families={catalog.families} familyId={assignFamilyId} subtypeId={assignSubtypeId} onFamily={(value) => { setAssignFamilyId(value); setAssignSubtypeId(""); }} onSubtype={setAssignSubtypeId} onSave={() => { if (preview) void classify([preview]); }} onClear={() => { if (preview) void classify([preview], true); }} onClose={() => { setPreviewKey(null); setPreview(null); }} saving={saving} />}
    {taxonomyOpen && <TaxonomyManager families={catalog.families} onClose={() => setTaxonomyOpen(false)} onChanged={load} />}
    {notice && <p role="status" className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-xl">{notice}</p>}
  </div>;
}

function FamilyButton({ active, label, count, meta, onClick, compact = false }: { active: boolean; label: string; count: number; meta?: string; onClick: () => void; compact?: boolean }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`flex w-full items-center justify-between gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"} ${active ? "bg-indigo-50 font-medium text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><span className="min-w-0"><span className="block truncate">{label}</span>{meta && <span className="block text-[11px] font-normal text-muted-foreground">{meta}</span>}</span><span className="shrink-0 tabular-nums">{count}</span></button>;
}

function AdRow({ ad, checked, active, onCheck, onOpen }: { ad: AdSummary; checked: boolean; active: boolean; onCheck: (checked: boolean) => void; onOpen: () => void }) {
  return <div className={`grid grid-cols-[40px_minmax(0,1fr)] gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[40px_minmax(200px,1.5fr)_minmax(160px,1fr)_minmax(150px,1fr)_110px] ${active ? "bg-indigo-50/70 dark:bg-indigo-950/20" : "hover:bg-muted/40"}`}>
    <div className="flex items-start justify-center pt-1"><input aria-label={`Select ${ad.title}`} type="checkbox" checked={checked} onChange={(event) => onCheck(event.target.checked)} className="h-4 w-4" /></div>
    <button onClick={onOpen} className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><span className="block truncate text-sm font-medium">{ad.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{ad.excerpt || "No preview text"}</span></button>
    <div className="col-start-2 min-w-0 text-sm md:col-start-auto"><span className="block truncate">{ad.seriesTitle}</span>{ad.archived && <span className="text-xs text-amber-700 dark:text-amber-300">Archived</span>}</div>
    <div className="col-start-2 text-sm text-muted-foreground md:col-start-auto">{ad.familyName && ad.subtypeName ? <><span className="block text-foreground">{ad.familyName}</span><span className="block text-xs">{ad.subtypeName}</span></> : <span className="text-amber-700 dark:text-amber-300">Unclassified</span>}</div>
    <time className="col-start-2 text-xs text-muted-foreground md:col-start-auto" dateTime={ad.updatedAt}>{new Date(ad.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time>
  </div>;
}

function ClassificationFields({ families, familyId, subtypeId, onFamily, onSubtype }: { families: TaxonomyFamily[]; familyId: string; subtypeId: string; onFamily: (value: string) => void; onSubtype: (value: string) => void }) {
  const family = families.find((item) => item.id === familyId);
  return <><label className="block text-xs font-medium text-muted-foreground">Creative Family<select value={familyId} onChange={(event) => onFamily(event.target.value)} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"><option value="">Choose Family</option>{families.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-xs font-medium text-muted-foreground">Subtype<select value={subtypeId} onChange={(event) => onSubtype(event.target.value)} disabled={!family} className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50"><option value="">Choose Subtype</option>{family?.subtypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>;
}

function AssignmentBar({ count, families, familyId, subtypeId, onFamily, onSubtype, onApply, onClear, onCancel, saving }: { count: number; families: TaxonomyFamily[]; familyId: string; subtypeId: string; onFamily: (v: string) => void; onSubtype: (v: string) => void; onApply: () => void; onClear: () => void; onCancel: () => void; saving: boolean }) {
  return <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-indigo-200 bg-card p-3 shadow-lg dark:border-indigo-900"><p className="self-center text-sm font-medium">{count} selected</p><div className="grid min-w-[320px] flex-1 gap-2 sm:grid-cols-2"><ClassificationFields families={families} familyId={familyId} subtypeId={subtypeId} onFamily={onFamily} onSubtype={onSubtype} /></div><button disabled={saving || !familyId || !subtypeId} onClick={onApply} className="min-h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50">Apply</button><button disabled={saving} onClick={onClear} className="min-h-10 rounded-md border border-border px-3 text-sm">Clear</button><button aria-label="Cancel selection" onClick={onCancel} className="min-h-10 min-w-10 rounded-md p-2 hover:bg-muted"><X className="h-4 w-4" /></button></div>;
}

function PreviewPanel({ ad, loading, families, familyId, subtypeId, onFamily, onSubtype, onSave, onClear, onClose, saving }: { ad: AdPreview | null; loading: boolean; families: TaxonomyFamily[]; familyId: string; subtypeId: string; onFamily: (v: string) => void; onSubtype: (v: string) => void; onSave: () => void; onClear: () => void; onClose: () => void; saving: boolean }) {
  return <div className="fixed inset-0 z-50 flex justify-end"><button aria-label="Close ad preview" onClick={onClose} className="absolute inset-0 bg-black/35" /><aside className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="preview-title"><header className="flex items-start justify-between border-b border-border p-5"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Ad preview</p><h2 id="preview-title" className="mt-1 truncate text-lg font-semibold">{ad?.title || "Loading…"}</h2><p className="mt-1 truncate text-sm text-muted-foreground">{ad?.seriesTitle}</p></div><button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-md p-2 hover:bg-muted"><X className="h-5 w-5" /></button></header>{loading || !ad ? <div className="p-5 text-sm text-muted-foreground">Loading preview…</div> : <><div className="min-h-0 flex-1 overflow-y-auto p-5"><pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-foreground">{ad.plainText}</pre></div><footer className="space-y-3 border-t border-border bg-card p-5"><div className="grid gap-2 sm:grid-cols-2"><ClassificationFields families={families} familyId={familyId} subtypeId={subtypeId} onFamily={onFamily} onSubtype={onSubtype} /></div><div className="flex flex-wrap gap-2"><button disabled={saving || !familyId || !subtypeId} onClick={onSave} className="min-h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50">Save classification</button><button disabled={saving || !ad.familyId} onClick={onClear} className="min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50">Clear</button><Link href={`/doc/${ad.documentId}?tab=${encodeURIComponent(ad.tabId)}&section=${encodeURIComponent(ad.sectionUid)}`} className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Open in Series <ExternalLink className="h-4 w-4" /></Link></div></footer></>}</aside></div>;
}

function EmptyState({ hasTaxonomy, onManage, onReset }: { hasTaxonomy: boolean; onManage: () => void; onReset: () => void }) {
  return <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center"><h2 className="font-semibold">No ads match this view</h2><p className="mt-2 text-sm text-muted-foreground">{hasTaxonomy ? "Try clearing the search or filters." : "Create your first Creative Family and Subtype, then classify the saved ads."}</p><button onClick={hasTaxonomy ? onReset : onManage} className="mt-4 min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">{hasTaxonomy ? "Clear filters" : "Manage Taxonomy"}</button></div>;
}
