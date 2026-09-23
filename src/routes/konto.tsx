import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { getCustomerProfile } from "@/lib/customer-profile.functions";
import { getShopUser, shopUpdateAccount } from "@/lib/shop-auth.functions";

export const Route = createFileRoute("/konto")({
  head: () => ({
    meta: [
      { title: "Mein Konto — MAWA Trading Distribution" },
      {
        name: "description",
        content: "Stammdaten, Anzeigename und Passwort Ihres MAWA-Kundenkontos.",
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
    const profile = await getCustomerProfile().catch(() => null);
    return { user, profile };
  },
  component: AccountPage,
});

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 border-b border-border py-2 last:border-b-0">
      <span className="label-mono w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-sm text-foreground">{value}</span>
    </div>
  );
}

function AccountPage() {
  const { user, profile } = Route.useLoaderData();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [showPassword, setShowPassword] = useState(false);
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
        setShowPassword(false);
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

  const addressLine = profile?.address
    ? [
        profile.address.street,
        [profile.address.zipcode, profile.address.city].filter(Boolean).join(" "),
        [profile.address.state, profile.address.countryCode].filter(Boolean).join(" · "),
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-12">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground"
        >
          ← Zurück zum Einkaufen
        </Link>
        <span className="label-mono text-muted-foreground">
          {profile?.customerNumber ?? user.customerNumber ?? ""}
        </span>
      </div>

      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Mein Konto</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Angemeldet als <span className="text-foreground">{user.displayName ?? user.email}</span>
      </p>

      <section className="mt-8 rounded-sm border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Stammdaten</h2>
        {profile ? (
          <div className="mt-3">
            <Field label="Kundennummer" value={profile.customerNumber} />
            <Field label="Firma" value={profile.company} />
            <Field label="Adresse" value={addressLine} />
            <Field label="E-Mail" value={profile.email} />
            <Field label="Telefon" value={profile.phone} />
            <Field label="Mobil" value={profile.mobile} />
            <Field label="Website" value={profile.website} />
            <Field label="UID-Nummer" value={profile.vatId} />
            <Field label="Zahlungsbedingung" value={profile.paymentTerm} />
            <Field label="Währung" value={profile.currency} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Stammdaten sind derzeit nicht abrufbar.
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Änderungen an den Stammdaten nimmt Ihr MAWA-Ansprechpartner vor.
        </p>
      </section>

      <form onSubmit={submit} className="mt-6 rounded-sm border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Zugang</h2>
        <div className="mt-3">
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

        <div className="mt-5 border-t border-border pt-4">
          {showPassword ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Passwort erneuern</h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowPassword(false);
                    setCurrentPassword("");
                    setPassword("");
                    setRepeat("");
                  }}
                  className="label-mono text-muted-foreground hover:text-accent"
                >
                  Abbrechen
                </button>
              </div>
              <div>
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
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              className="rounded-sm border border-border bg-panel px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground"
            >
              Passwort erneuern
            </button>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        {done && <p className="mt-4 text-sm text-stock">{done}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
        >
          {busy ? "Speichern …" : "Speichern"}
        </button>
      </form>
    </main>
  );
}
