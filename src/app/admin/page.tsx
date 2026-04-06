"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: "admin" | "user";
  active: boolean;
  createdAt: string;
}

interface Doc {
  id: string;
  title: string;
  ownerId: string;
  updatedAt: string;
}

interface AIConfig {
  anthropic: boolean;
  google: boolean;
}

export default function AdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [tab, setTab] = useState<"users" | "docs" | "ai">("users");

  // AI settings form
  const [anthropicKey, setAnthropicKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [aiSaving, setAiSaving] = useState<string | null>(null);

  // Transfer ownership
  const [transferDocId, setTransferDocId] = useState<string | null>(null);
  const [transferUserId, setTransferUserId] = useState("");

  useEffect(() => {
    if (session?.user?.role !== "admin") {
      router.push("/");
      return;
    }
    fetchData();
  }, [session, router]);

  const fetchData = async () => {
    const [usersRes, docsRes, aiRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/documents"),
      fetch("/api/admin/ai-settings"),
    ]);
    if (usersRes.ok) setUsers(await usersRes.json());
    if (docsRes.ok) setDocs(await docsRes.json());
    if (aiRes.ok) {
      setAiConfig(await aiRes.json());
    }
  };

  const toggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    fetchData();
  };

  const toggleActive = async (userId: string, currentActive: boolean) => {
    await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !currentActive }),
    });
    fetchData();
  };

  const transferOwnership = async (docId: string) => {
    if (!transferUserId) return;
    await fetch(`/api/admin/documents/${docId}/owner`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newOwnerId: transferUserId }),
    });
    setTransferDocId(null);
    setTransferUserId("");
    fetchData();
  };

  const saveAIKey = async (provider: string, apiKey: string) => {
    if (!apiKey) return;
    setAiSaving(provider);
    await fetch("/api/admin/ai-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey }),
    });
    if (provider === "anthropic") setAnthropicKey("");
    else setGoogleKey("");
    setAiSaving(null);
    fetchData();
  };

  if (session?.user?.role !== "admin") return null;

  const ownerName = (ownerId: string) => {
    const u = users.find((u) => u.id === ownerId);
    return u?.name || u?.email || ownerId;
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
              &larr; Back
            </Link>
            <h1 className="text-xl font-bold">Admin Panel</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Tabs */}
        <div className="mb-6 flex gap-1 border-b border-gray-200">
          {(["users", "docs", "ai"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "users" ? "Users" : t === "docs" ? "Documents" : "AI Settings"}
            </button>
          ))}
        </div>

        {/* Users Tab */}
        {tab === "users" && (
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                  user.active ? "border-gray-200" : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  {user.image && (
                    <img
                      src={user.image}
                      alt=""
                      className="h-8 w-8 rounded-full"
                    />
                  )}
                  <div>
                    <p className="font-medium">
                      {user.name || "No name"}
                      {!user.active && (
                        <span className="ml-2 text-xs text-red-600">
                          (Deactivated)
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      user.role === "admin"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {user.role}
                  </span>
                  {user.id !== session.user.id && (
                    <>
                      <button
                        onClick={() => toggleRole(user.id, user.role)}
                        className="text-xs text-indigo-600 hover:text-indigo-800"
                      >
                        {user.role === "admin"
                          ? "Remove admin"
                          : "Make admin"}
                      </button>
                      <button
                        onClick={() => toggleActive(user.id, user.active)}
                        className={`text-xs ${
                          user.active
                            ? "text-red-600 hover:text-red-800"
                            : "text-green-600 hover:text-green-800"
                        }`}
                      >
                        {user.active ? "Deactivate" : "Activate"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {users.length === 0 && (
              <p className="py-8 text-center text-gray-500">No users yet</p>
            )}
          </div>
        )}

        {/* Documents Tab */}
        {tab === "docs" && (
          <div className="space-y-2">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{doc.title || "Untitled"}</p>
                  <p className="text-sm text-gray-500">
                    Owner: {ownerName(doc.ownerId)}
                  </p>
                </div>
                <div>
                  {transferDocId === doc.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={transferUserId}
                        onChange={(e) => setTransferUserId(e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="">Select user...</option>
                        {users
                          .filter((u) => u.id !== doc.ownerId && u.active)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name || u.email}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => transferOwnership(doc.id)}
                        className="text-xs font-medium text-indigo-600"
                      >
                        Transfer
                      </button>
                      <button
                        onClick={() => setTransferDocId(null)}
                        className="text-xs text-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setTransferDocId(doc.id)}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Transfer ownership
                    </button>
                  )}
                </div>
              </div>
            ))}
            {docs.length === 0 && (
              <p className="py-8 text-center text-gray-500">
                No documents yet
              </p>
            )}
          </div>
        )}

        {/* AI Settings Tab */}
        {tab === "ai" && (
          <div className="max-w-lg space-y-6">
            <p className="text-sm text-gray-500">
              Add API keys for one or both providers. Writers choose which model to use in the editor.
            </p>

            {/* Anthropic */}
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Anthropic (Claude)</h4>
                {aiConfig?.anthropic ? (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Configured</span>
                ) : (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Not set</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder={aiConfig?.anthropic ? "Enter new key to replace..." : "sk-ant-..."}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => saveAIKey("anthropic", anthropicKey)}
                  disabled={aiSaving !== null || !anthropicKey}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {aiSaving === "anthropic" ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            {/* Google */}
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Google (Gemini)</h4>
                {aiConfig?.google ? (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Configured</span>
                ) : (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Not set</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={googleKey}
                  onChange={(e) => setGoogleKey(e.target.value)}
                  placeholder={aiConfig?.google ? "Enter new key to replace..." : "AIza..."}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => saveAIKey("google", googleKey)}
                  disabled={aiSaving !== null || !googleKey}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {aiSaving === "google" ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
