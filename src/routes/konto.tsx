import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { getShopUser, shopUpdateAccount } from "@/lib/shop-auth.functions";

export const Route = createFileRoute("/konto")({
  head: () => ({
    meta: [
      { title: "Mein Konto — MAWA Trading Distribution" },
      {
        name: "description",
        content: "Anzeigename und Passwort Ihres MAWA-Kundenkontos ändern.",
      },
      { property: "og:title", content: "Mein Konto — MAWA Trading Distribution" },
      {
        property: "og:description",
        content: "Kontoeinstellungen für Fachhandelspartner im MAWA Distributionsportal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async () => {
    const user = await getShopUser().catch(() => null);
    if (!user) throw redirect({ to: "/anmelden" });
    return { user };
  },
  component: AccountPage,
});

function AccountPage() {
  const { user } = Route.useLoaderData();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (password && password !== repeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      const result = await shopUpdateAccount({
        data: {
          displayName: displayName.trim() === (user.displayName ?? "") ? undefined : displayName,
          password: password || undefined,
          currentPassword: currentPassword || undefined,
        },
      });
      if (result.ok) {
        setDone("Änderungen gespeichert.");
        setPassword("");
        setRepeat("");
        setCurrentPassword("");
        await router.invalidate();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Änderung konnte nicht gespeichert werden. Bitte später erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Link to="/" className="label-mono text-muted-foreground hover:text-accent">
        ← Zum Katalog
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Mein Konto</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Angemeldet als <span className="text-foreground">{user.email}</span>
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label-mono text-muted-foreground" htmlFor="displayName">
            Anzeigename
          </label>
          <input
            id="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
          />
        </div>

        <div className="border-t border-border pt-4">
          <label className="label-mono text-muted-foreground" htmlFor="currentPassword">
            Aktuelles Passwort
          </label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="label-mono text-muted-foreground" htmlFor="password">
            Neues Passwort
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="label-mono text-muted-foreground" htmlFor="repeat">
            Neues Passwort wiederholen
          </label>
          <input
            id="repeat"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            className={inputClass}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {done && <p className="text-sm text-stock">{done}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {busy ? "Speichern …" : "Speichern"}
        </button>
      </form>
    </main>
  );
}
