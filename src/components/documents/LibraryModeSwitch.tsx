import Link from "next/link";

export default function LibraryModeSwitch({ active }: { active: "scripts" | "ads" }) {
  return (
    <nav aria-label="Library view" className="inline-flex rounded-lg border border-border bg-muted p-1 text-sm">
      <Link
        href="/docs"
        aria-current={active === "scripts" ? "page" : undefined}
        className={`min-h-9 rounded-md px-4 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${active === "scripts" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        Scripts
      </Link>
      <Link
        href="/docs/ads"
        aria-current={active === "ads" ? "page" : undefined}
        className={`min-h-9 rounded-md px-4 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${active === "ads" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        Ads
      </Link>
    </nav>
  );
}
