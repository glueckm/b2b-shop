import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import mawaLogo from "@/assets/mawa-logo-white.png";
import { leadSchema, submitCustomerLead, type LeadInput } from "@/lib/lead.functions";
import { SHOP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/kundenanfrage")({
  head: () => ({
    meta: [
      { title: "Händlerkonto anfordern — MAWA Trading Distribution" },
      {
        name: "description",
        content:
          "Fachhändler fordern hier ein MAWA-Händlerkonto mit Zugang zum B2B Shop an: Firmendaten, UID-Nummer und Ansprechpartner in einem Formular.",
      },
      { property: "og:title", content: "Händlerkonto anfordern — MAWA Trading Distribution" },
      {
        property: "og:description",
        content: "Firmendaten für ein MAWA-Händlerkonto erfassen und Zugang zum B2B Shop anfordern.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadPage,
});

const EMPTY: LeadInput = {
  company: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  website: "",
  vatId: "",
  street: "",
  zipcode: "",
  city: "",
  country: "",
  businessType: "",
  message: "",
};

const LABELS: Record<keyof LeadInput, string> = {
  company: "Firmenname",
  firstName: "Vorname",
  lastName: "Nachname",
  email: "E-Mail",
  phone: "Telefon",
  website: "Website",
  vatId: "UID-Nummer",
  street: "Straße und Hausnummer",
  zipcode: "PLZ",
  city: "Ort",
  country: "Land",
  businessType: "Art des Geschäfts",
  message: "Nachricht",
};

const BUSINESS_TYPES = [
  "Fachhandel / Ladengeschäft",
  "Onlinehandel",
  "Fachhandel und Onlinehandel",
  "Büchsenmacher / Werkstatt",
  "Sub-Distribution",
  "Sonstiges",
];

function LeadPage() {
  const [form, setForm] = useState<LeadInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof LeadInput, string>>>({});
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function set<K extends keyof LeadInput>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setInfo(null);
    setFailure(null);
    const parsed = leadSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof LeadInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof LeadInput;
        if (key && !next[key]) {
          next[key] =
            key === "email"
              ? "Bitte eine gültige E-Mail-Adresse angeben."
              : "Bitte ausfüllen.";
        }
      }
      setErrors(next);
      setFailure("Bitte die markierten Felder prüfen.");
      return;
    }
    setBusy(true);
    try {
      const result = await submitCustomerLead({ data: parsed.data });
      if (result.ok) {
        setInfo(result.message);
        setForm(EMPTY);
      } else {
        setFailure(result.message);
      }
    } catch {
      setFailure("Die Anfrage konnte nicht gesendet werden. Bitte später erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent";

  function field(
    key: keyof LeadInput,
    options?: { type?: string; required?: boolean; placeholder?: string },
  ) {
    return (
      <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {LABELS[key]}
        {options?.required === false ? " (optional)" : " *"}
        <input
          type={options?.type ?? "text"}
          value={form[key] ?? ""}
          onChange={(event) => set(key, event.target.value)}
          placeholder={options?.placeholder}
          className={inputClass}
          autoComplete="off"
        />
        {errors[key] ? <span className="mt-1 block text-xs font-normal text-destructive">{errors[key]}</span> : null}
      </label>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-sm bg-panel px-6 py-6 text-center">
        <img src={mawaLogo} alt="MAWA Trading" className="mx-auto h-10 w-auto" />
        <h1 className="mt-3 text-xl font-bold tracking-tight text-panel-foreground">
          Händlerkonto anfordern
        </h1>
        <p className="mt-1 text-sm text-panel-foreground/70">
          Bitte erfassen Sie Ihre Firmendaten – wir prüfen die Anfrage und melden uns mit den
          nächsten Schritten.
        </p>
      </div>

      <div className="mt-4">
        <Link to="/anmelden" className="text-sm font-semibold text-accent hover:underline">
          ← Zurück zur Anmeldung
        </Link>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <section className="rounded-sm border border-border bg-card/40 p-5">
          <h2 className="text-base font-semibold tracking-tight">Firma</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("company")}</div>
            {field("vatId", { placeholder: "z. B. ATU12345678" })}
            {field("businessType") && (
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {LABELS.businessType} *
                <select
                  value={form.businessType}
                  onChange={(event) => set("businessType", event.target.value)}
                  className={inputClass}
                >
                  <option value="">Bitte wählen</option>
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                {errors.businessType ? (
                  <span className="mt-1 block text-xs font-normal text-destructive">
                    {errors.businessType}
                  </span>
                ) : null}
              </label>
            )}
            <div className="sm:col-span-2">{field("street")}</div>
            {field("zipcode")}
            {field("city")}
            {field("country", { placeholder: "z. B. Österreich" })}
            {field("website", { required: false, placeholder: "https://" })}
          </div>
        </section>

        <section className="rounded-sm border border-border bg-card/40 p-5">
          <h2 className="text-base font-semibold tracking-tight">Ansprechpartner</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {field("firstName")}
            {field("lastName")}
            {field("email", { type: "email" })}
            {field("phone", { type: "tel" })}
          </div>
        </section>

        <section className="rounded-sm border border-border bg-card/40 p-5">
          <h2 className="text-base font-semibold tracking-tight">Nachricht</h2>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {LABELS.message} (optional)
            <textarea
              value={form.message}
              onChange={(event) => set("message", event.target.value)}
              rows={4}
              className={inputClass}
              placeholder="Welche Produktbereiche interessieren Sie?"
            />
          </label>
        </section>

        {failure ? (
          <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {failure}
          </p>
        ) : null}
        {info ? (
          <p className="rounded-sm border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
            {info}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-sm bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {busy ? "Anfrage wird gesendet …" : "Anfrage senden"}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          Eine Bestätigung geht an Ihre angegebene E-Mail-Adresse.
        </p>
      </form>

      <p className="mt-10 text-center text-xs text-muted-foreground">Version {SHOP_VERSION}</p>
    </main>
  );
}
