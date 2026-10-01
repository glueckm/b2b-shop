import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import agbText from "@/data/agb.txt?raw";
import agbDeText from "@/data/agb-de.txt?raw";

export const Route = createFileRoute("/agb")({
  head: () => ({
    meta: [
      { title: "AGB — MAWA Trading GmbH" },
      { name: "description", content: "Allgemeine Geschäftsbedingungen der MAWA Trading GmbH für Geschäftskunden." },
      { property: "og:title", content: "AGB — MAWA Trading GmbH" },
      { property: "og:description", content: "Allgemeine Geschäftsbedingungen für Warenlieferungen an Geschäftskunden." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgbPage,
});

function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.history.back() : void router.navigate({ to: "/" }))}
      className="rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
    >
      ← Zurück
    </button>
  );
}

function Body({ lines }: { lines: string[] }) {
  return (
    <div className="mt-6 space-y-3 text-[14px] leading-relaxed">
      {lines.map((l, i) =>
        /^\d{1,2} \S/.test(l) && l.length < 90 ? (
          <h2 key={i} className="pt-4 text-lg font-bold">{l}</h2>
        ) : (
          <p key={i}>{l}</p>
        ),
      )}
    </div>
  );
}

function AgbPage() {
  const [land, setLand] = useState<"AT" | "DE">("AT");
  const deLines = agbDeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = agbText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const [title, subtitle, ...body] = lines;
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <div className="sticky top-0 z-10 -mx-5 bg-background/95 px-5 py-3 backdrop-blur">
        <BackButton />
      </div>
      <div className="mt-4 flex gap-1 border-b border-border">
        {(["AT", "DE"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setLand(c)}
            className={`-mb-px rounded-t-sm border border-border px-5 py-2 text-sm font-semibold ${land === c ? "border-b-background bg-background text-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            {c === "AT" ? "Österreich" : "Deutschland"}
          </button>
        ))}
      </div>
      {land === "DE" ? (
        <>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">AGB für Kunden aus Deutschland</h1>
          <p className="mt-1 text-sm text-muted-foreground">MAWA Trading GmbH (Deutschland)</p>
          <Body lines={deLines} />
        </>
      ) : (
        <>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <Body lines={body} />
        </>
      )}
      <div className="mt-10 flex gap-3">
        <BackButton />
        <Link to="/" className="rounded-sm border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">
          Zum Shop
        </Link>
      </div>
    </main>
  );
}
