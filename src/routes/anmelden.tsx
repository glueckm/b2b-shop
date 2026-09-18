import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { shopLogin } from "@/lib/shop-auth.functions";
import { requestShopAccess } from "@/lib/shop-signup.functions";

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
  const [customerNumber, setCustomerNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Zugang anfordern
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupNumber, setSignupNumber] = useState("");
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupInfo, setSignupInfo] = useState<string | null>(null);

  async function requestAccess(event: React.FormEvent) {
    event.preventDefault();
    setSignupBusy(true);
    setSignupError(null);
    setSignupInfo(null);
    try {
      const result = await requestShopAccess({ data: { customerNumber: signupNumber } });
      if (!result.ok) {
        setSignupError(result.error);
      } else if (result.kind === "granted") {
        const target = result.hint ?? result.email;
        setSignupInfo(
          [
            "Ihr Shop-Zugang wurde freigeschaltet.",
            target
              ? `Wir haben einen Link zum Setzen Ihres Passworts an ${target} geschickt.`
              : "Wir haben Ihnen einen Link zum Setzen Ihres Passworts geschickt.",
            "Bitte prüfen Sie auch Ihren Spam-Ordner. Der Link ist aus Sicherheitsgründen nur begrenzt gültig – danach können Sie den Zugang hier erneut anfordern.",
          ].join(" "),
        );
        setSignupNumber("");
      } else {
        setSignupInfo(result.message);
      }
    } catch {
      setSignupError("Anfrage derzeit nicht möglich. Bitte später erneut versuchen.");
    } finally {
      setSignupBusy(false);
    }
  }


  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await shopLogin({ data: { customerNumber, password } });
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
        Mit Ihrer Kundennummer und Ihrem Passwort anmelden. Nach der Anmeldung erkennen wir Ihre
        Kundendaten und Konditionen.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label className="label-mono text-muted-foreground" htmlFor="customerNumber">
            Kundennummer
          </label>
          <input
            id="customerNumber"
            type="text"
            inputMode="numeric"
            autoComplete="username"
            required
            value={customerNumber}
            onChange={(event) => setCustomerNumber(event.target.value)}
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

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="text-base font-semibold tracking-tight">Noch kein Zugang?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Fordern Sie Ihren Shop-Zugang mit Ihrer Kundennummer an. Wir prüfen Ihr Kundenkonto und
          senden Ihnen einen Link zum Setzen Ihres Passworts.
        </p>

        {!signupOpen ? (
          <button
            type="button"
            onClick={() => setSignupOpen(true)}
            className="mt-4 w-full rounded-sm border border-accent px-4 py-2.5 text-sm font-semibold text-accent hover:bg-accent/10"
          >
            Zugang anfordern
          </button>
        ) : (
          <form onSubmit={requestAccess} className="mt-4 space-y-4">
            <div>
              <label className="label-mono text-muted-foreground" htmlFor="signupNumber">
                Kundennummer
              </label>
              <input
                id="signupNumber"
                type="text"
                inputMode="numeric"
                required
                value={signupNumber}
                onChange={(event) => setSignupNumber(event.target.value)}
                className="mt-1 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            {signupError && <p className="text-sm text-destructive">{signupError}</p>}
            {signupInfo && <p className="text-sm text-stock">{signupInfo}</p>}

            <button
              type="submit"
              disabled={signupBusy}
              className="w-full rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
            >
              {signupBusy ? "Wird geprüft …" : "Zugang anfordern"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
