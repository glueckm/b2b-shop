import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import mawaLogo from "@/assets/mawa-logo-white.png";
import { useState } from "react";

import { shopLogin } from "@/lib/shop-auth.functions";
import { requestShopPasswordReset } from "@/lib/shop-password.functions";
import { requestShopAccess } from "@/lib/shop-signup.functions";
import { SHOP_VERSION } from "@/lib/version";

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
  const [customerNumber, setCustomerNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  // Zugang anfordern
  const [signupNumber, setSignupNumber] = useState("");
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupInfo, setSignupInfo] = useState<string | null>(null);

  const [tab, setTab] = useState<"login" | "signup">("login");
  const [showPassword, setShowPassword] = useState(false);

  // Passwort vergessen
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  async function requestReset(event: React.FormEvent) {
    event.preventDefault();
    setResetBusy(true);
    setResetError(null);
    setResetInfo(null);
    try {
      const result = await requestShopPasswordReset({ data: { email: resetEmail } });
      if (result.ok) {
        setResetInfo(
          `Wenn für ${resetEmail} ein Shop-Zugang besteht, haben wir einen Link zum Setzen eines neuen Passworts geschickt. Bitte prüfen Sie auch Ihren Spam-Ordner.`,
        );
        setResetEmail("");
      } else {
        setResetError(result.error);
      }
    } catch {
      setResetError("Anfrage derzeit nicht möglich. Bitte später erneut versuchen.");
    } finally {
      setResetBusy(false);
    }
  }

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
        // Katalog wird geladen – Spinner bleibt bis zum Seitenwechsel sichtbar.
        setLoadingCatalog(true);
        await navigate({
          to: "/",
          // Alle Parameter vollständig setzen, sonst normalisiert der Router
          // die Adresse und lädt den Katalog ein zweites Mal.
          search: {
            channel: "NET1",
            category: "Highlights",
            subcategory: "",
            subsubcategory: "",
            q: "",
          },
        });
        return;
      }
      setError(result.error);
    } catch {
      setError("Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.");
      setLoadingCatalog(false);
    }
    setBusy(false);
  }

  const inputClass =
    "mt-2 w-full rounded-sm border border-border bg-panel px-3 py-2.5 text-sm outline-none focus:border-accent";

  const features = [
    { icon: "€", title: "Ihre Konditionen", text: "Händlerpreise und Staffeln direkt aus Ihrem Kundenkonto." },
    { icon: "●", title: "Live-Verfügbarkeit", text: "Lagerstand und Liefertermine vor der Bestellung sehen." },
    { icon: "↻", title: "Aufträge & Rechnungen", text: "Status, Lieferscheine und Rechnungen an einem Ort." },
  ];

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/60 p-4 lg:p-10">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-lg border border-border shadow-2xl lg:min-h-[640px] lg:grid-cols-2">
      {loadingCatalog && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/85 backdrop-blur-sm">
          <span className="size-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
          <p className="text-sm text-muted-foreground">Katalog wird geladen …</p>
        </div>
      )}

      {/* Linke Seite: Marke */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-primary px-8 py-10 text-primary-foreground sm:px-12 lg:px-14 lg:py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-40 size-[34rem] rounded-full border-[3.5rem] border-accent/10"
        />
        <div className="relative">
          <img src={mawaLogo} alt="MAWA Trading" width={369} height={77} className="h-10 w-auto" />
          <p className="label-mono mt-2 text-primary-foreground/55">Distribution B2B</p>

          <h1 className="mt-10 text-4xl font-bold leading-tight tracking-tight lg:text-5xl">
            Der Partner-Shop für den <span className="text-accent">Jagd- und Outdoor-Fachhandel.</span>
          </h1>

          <ul className="mt-12 space-y-6">
            {features.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-accent/15 text-sm text-accent">
                  {f.icon}
                </span>
                <div>
                  <p className="font-semibold">{f.title}</p>
                  <p className="mt-0.5 text-sm text-primary-foreground/75">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="label-mono relative mt-12 flex gap-x-4 overflow-hidden whitespace-nowrap text-primary-foreground/45">
          {["NOCPIX", "INFIRAY", "PARD", "RUSAN", "NITECORE", "KEEPPOWER", "RECKNAGEL"].map((b) => (
            <span key={b}>{b}</span>
          ))}
        </p>
      </section>

      {/* Rechte Seite: Formular */}
      <section className="flex items-center justify-center bg-background px-6 py-12 lg:px-12">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-bold tracking-tight">Anmelden</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Mit Kundennummer und Passwort. Danach sehen Sie Ihre Preise und Konditionen.
          </p>

          <div className="mt-8 grid grid-cols-2 border-b border-border text-sm font-semibold">
            {(["login", "signup"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 py-3 ${
                  tab === t
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "login" ? "Anmelden" : "Zugang anfordern"}
              </button>
            ))}
          </div>

          {tab === "login" ? (
            <form onSubmit={submit} className="mt-6 space-y-5">
              <div>
                <label className="text-sm font-semibold" htmlFor="customerNumber">
                  Kundennummer
                </label>
                <input
                  id="customerNumber"
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="z. B. 10482"
                  value={customerNumber}
                  onChange={(event) => setCustomerNumber(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm font-semibold" htmlFor="password">
                  Passwort
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={`${inputClass} pr-24`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? "Verbergen" : "Anzeigen"}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setResetOpen(true);
                    setResetError(null);
                    setResetInfo(null);
                  }}
                  className="text-sm font-semibold text-accent hover:underline"
                >
                  Passwort vergessen?
                </button>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
              >
                {busy && (
                  <span className="size-4 animate-spin rounded-full border-2 border-accent-foreground/40 border-t-accent-foreground" />
                )}
                {loadingCatalog ? "Katalog wird geladen …" : busy ? "Anmelden …" : "Anmelden"}
              </button>
            </form>
          ) : (
            <div className="mt-6">
              <p className="text-sm text-muted-foreground">
                Bereits Kunde, aber noch keinen B2B Shop Zugang? Geben Sie Ihre Kundennummer ein –
                wir prüfen Ihr Kundenkonto und senden Ihnen einen Link zum Setzen Ihres Passworts.
              </p>
              <form onSubmit={requestAccess} className="mt-5 space-y-5">
                <div>
                  <label className="text-sm font-semibold" htmlFor="signupNumber">
                    Kundennummer
                  </label>
                  <input
                    id="signupNumber"
                    type="text"
                    required
                    placeholder="z. B. 10482"
                    value={signupNumber}
                    onChange={(event) => setSignupNumber(event.target.value)}
                    className={inputClass}
                  />
                </div>
                {signupError && <p className="text-sm text-destructive">{signupError}</p>}
                {signupInfo && <p className="text-sm text-stock">{signupInfo}</p>}
                <button
                  type="submit"
                  disabled={signupBusy}
                  className="w-full rounded-sm bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
                >
                  {signupBusy ? "Wird geprüft …" : "Zugang anfordern"}
                </button>
              </form>
              <div className="mt-8 border-t border-border pt-5 text-sm">
                <p className="font-semibold">Noch kein Kunde?</p>
                <p className="mt-1 text-muted-foreground">
                  Fordern Sie ein Händlerkonto samt Shop-Zugang an.
                </p>
                <Link
                  to="/kundenanfrage"
                  className="mt-3 inline-block font-semibold text-accent hover:underline"
                >
                  Händlerkonto anfordern →
                </Link>
              </div>
            </div>
          )}

          <p className="label-mono mt-8 text-right text-muted-foreground">Version {SHOP_VERSION}</p>
        </div>
      </section>
      </div>

      {resetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4"
          onClick={() => setResetOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-sm border border-border bg-background p-6 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-base font-semibold tracking-tight">Passwort vergessen?</h2>
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                aria-label="Schließen"
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Geben Sie Ihre E-Mail-Adresse ein – wir senden Ihnen einen Link zum Setzen eines neuen
              Passworts.
            </p>
            <form onSubmit={requestReset} className="mt-4 space-y-3">
              <input
                type="email"
                required
                value={resetEmail}
                placeholder="ihre@firma.at"
                onChange={(event) => setResetEmail(event.target.value)}
                className="w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              />
              {resetError && <p className="text-sm text-destructive">{resetError}</p>}
              {resetInfo && <p className="text-sm text-stock">{resetInfo}</p>}
              <button
                type="submit"
                disabled={resetBusy}
                className="w-full rounded-sm border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-60"
              >
                {resetBusy ? "Wird gesendet …" : "Link zum Passwortsetzen senden"}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
