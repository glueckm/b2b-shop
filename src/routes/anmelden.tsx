import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { shopLogin } from "@/lib/shop-auth.functions";

export const Route = createFileRoute("/anmelden")({
  head: () => ({
    meta: [
      { title: "Kundenanmeldung — MAWA Trading Distribution" },
      {
        name: "description",
        content:
          "Melden Sie sich mit Ihrem MAWA-Kundenkonto an, um Ihre Konditionen, Preise und Artikelbilder zu sehen.",
      },
      { property: "og:title", content: "Kundenanmeldung — MAWA Trading Distribution" },
      {
        property: "og:description",
        content: "Anmeldung für Fachhandelspartner im MAWA Distributionsportal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await shopLogin({ data: { email, password } });
      if (result.ok) {
        await router.invalidate();
        void navigate({ to: "/", search: { channel: "NET1", category: "", subcategory: "", q: "" } });
      } else {
        setError(result.error);
      }
    } catch {
      setError("Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-16">
      <Link to="/" className="label-mono text-muted-foreground hover:text-accent">
        ← Zum Katalog
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Kundenanmeldung</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Mit Ihrem MAWA-Konto anmelden. Nach der Anmeldung erkennen wir Ihre Kundendaten und
        Konditionen.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label-mono text-muted-foreground" htmlFor="email">
            E-Mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="label-mono text-muted-foreground" htmlFor="password">
            Passwort
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {busy ? "Anmelden …" : "Anmelden"}
        </button>
      </form>
    </main>
  );
}
