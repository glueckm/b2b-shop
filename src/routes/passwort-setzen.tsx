import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { setShopPassword } from "@/lib/shop-password.functions";

type Search = { token?: string };

export const Route = createFileRoute("/passwort-setzen")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Passwort setzen — MAWA Trading Distribution" },
      {
        name: "description",
        content:
          "Setzen Sie Ihr Passwort für den MAWA Distributionsshop und melden Sie sich anschließend mit Ihrer Kundennummer an.",
      },
      { property: "og:title", content: "Passwort setzen — MAWA Trading Distribution" },
      {
        property: "og:description",
        content: "Neues Passwort für Ihren Shop-Zugang bei MAWA Trading Distribution festlegen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetPasswordPage,
});

function SetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (password !== repeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      const result = await setShopPassword({ data: { token: token ?? "", password } });
      if (result.ok) {
        setDone(true);
        setPassword("");
        setRepeat("");
        setTimeout(() => void navigate({ to: "/anmelden" }), 2500);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Passwort konnte nicht gesetzt werden. Bitte später erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Link to="/" className="label-mono text-muted-foreground hover:text-accent">
        ← Zum Katalog
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Passwort setzen</h1>

      {!token ? (
        <p className="mt-3 text-sm text-destructive">
          Dieser Link ist unvollständig. Bitte öffnen Sie den Link aus der E-Mail vollständig oder
          fordern Sie auf der Anmeldeseite einen neuen Link an.
        </p>
      ) : done ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-stock">
            Ihr Passwort ist gesetzt. Sie können sich jetzt mit Ihrer Kundennummer und dem neuen
            Passwort anmelden.
          </p>
          <Link
            to="/anmelden"
            className="block w-full rounded-sm bg-accent px-4 py-2.5 text-center text-sm font-semibold text-accent-foreground"
          >
            Zur Anmeldung
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Bitte wählen Sie ein Passwort mit mindestens 8 Zeichen. Danach melden Sie sich mit Ihrer
            Kundennummer und diesem Passwort an.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="label-mono text-muted-foreground" htmlFor="password">
                Neues Passwort
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="label-mono text-muted-foreground" htmlFor="repeat">
                Passwort wiederholen
              </label>
              <input
                id="repeat"
                type="password"
                autoComplete="new-password"
                required
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                className="mt-1 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
            >
              {busy ? "Passwort wird gesetzt …" : "Passwort setzen"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
