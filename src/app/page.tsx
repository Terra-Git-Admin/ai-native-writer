"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { isPitchLabEnabledForClient } from "@/lib/pitch-lab-flags";

export default function Home() {
  const { data: session, status } = useSession();
  const pitchLabEnabled = isPitchLabEnabledForClient();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  if (status === "loading" || !session?.user) {
    return <main className="mx-auto w-full max-w-5xl px-6 py-12 text-sm text-muted-foreground">Loading...</main>;
  }

  const isAdmin = session.user.role === "admin";

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold">AI Writer</Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            {session.user.role === "admin" && <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">Admin</Link>}
            <span className="text-sm text-foreground">{session.user.name}</span>
            <button onClick={() => signOut()} className="text-sm text-muted-foreground hover:text-foreground">Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="max-w-2xl">
          <p className="mb-2 text-sm font-medium text-indigo-600">AI Native Writer</p>
          <h1 className="text-3xl font-semibold tracking-tight">What would you like to work on?</h1>
          <p className="mt-3 text-muted-foreground">Start with a new pilot idea or continue with a document.</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {isAdmin && pitchLabEnabled && (
            <Link href="/pitch-lab" className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-indigo-400">
              <h2 className="text-lg font-semibold group-hover:text-indigo-600">Create new pilot ideas</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Generate plot ideas, shortlist the promising ones, and shape one into a new Writer document.</p>
              <span className="mt-6 inline-flex text-sm font-medium text-indigo-600">Open Pitch Lab <span aria-hidden="true" className="ml-1">→</span></span>
            </Link>
          )}
          <Link href="/docs" className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-indigo-400">
            <h2 className="text-lg font-semibold group-hover:text-indigo-600">View my docs</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Open an existing project or create a blank Writer document.</p>
            <span className="mt-6 inline-flex text-sm font-medium text-indigo-600">View documents <span aria-hidden="true" className="ml-1">→</span></span>
          </Link>
        </div>
      </main>
    </div>
  );
}
