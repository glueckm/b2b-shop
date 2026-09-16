import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { getCatalog, type CatalogArticle } from "@/lib/catalog.functions";
import { uploadArticleImageFn } from "@/lib/article-images.functions";
import { getShopUser } from "@/lib/shop-auth.functions";
import {
  formatBytes,
  MAX_EDGE,
  resizeForShop,
  THUMB_EDGE,
  thumbFileName,
} from "@/lib/resize-image";

export const Route = createFileRoute("/bilder")({
  // Bildpflege nur für angemeldete Kunden/Mitarbeiter.
  beforeLoad: async () => {
    const user = await getShopUser().catch(() => null);
    if (!user) throw redirect({ to: "/anmelden" });
  },
  loader: () => getCatalog({ data: { channel: "NET1", category: "", search: "" } }),
  head: () => ({
    meta: [
      { title: "Artikelbilder verwalten — MAWA Trading B2B" },
      {
        name: "description",
        content:
          "Artikelfotos für den MAWA Distributionskatalog hochladen und direkt dem passenden Artikel zuordnen.",
      },
      { property: "og:title", content: "Artikelbilder verwalten — MAWA Trading B2B" },
      {
        property: "og:description",
        content: "Fotos je Artikel hochladen; sie erscheinen sofort in Liste und Detailansicht.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: () => (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-2xl font-semibold">Artikelliste nicht erreichbar</h1>
    </div>
  ),
  notFoundComponent: () => <div className="px-5 py-24 text-center">Nicht gefunden</div>,
  component: ImageAdmin,
});

type Status = { file: string; state: "läuft" | "fertig" | "fehler"; message?: string | undefined };

// Vergleichsform: nur Buchstaben/Zahlen, klein.
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Artikelnummer aus dem Dateinamen ableiten — gleiche Regel wie im bestehenden
 * Python-Skript: Bildnummer steht nach dem letzten "_", die Artikelnummer sind die
 * ersten drei dreistelligen Blöcke (600-441-139), sonst nur der erste Block.
 */
export function articleNumberFromFileName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const [head, ...rest] = stem.split("_");
  const imageNo = rest.length > 0 ? (rest[rest.length - 1] ?? "1") : "1";
  const parts = (head ?? "").split("-");
  const [a, b, c] = parts;
  const number =
    parts.length >= 3 && a?.length === 3 && b?.length === 3 && c?.length === 3
      ? [a, b, c].join("-")
      : (a ?? "");
  return { number, imageNo };
}

/** Artikel aus dem Dateinamen ermitteln (Artikelnummer oder interne ID). */
function articleFromFileName(fileName: string, articles: CatalogArticle[]) {
  const { number } = articleNumberFromFileName(fileName);
  const needle = norm(number);
  if (!needle) return null;
  return articles.find((a) => norm(a.sku) === needle || norm(a.id) === needle) ?? null;
}

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

function ImageAdmin() {
  const { articles, images } = Route.useLoaderData() as {
    articles: CatalogArticle[];
    images?: Record<string, string[]>;
  };
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<CatalogArticle | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    // Ohne Suchbegriff die ersten Artikel zeigen, damit die Auswahl sofort sichtbar ist.
    if (!needle) return articles.slice(0, 12);
    return articles
      .filter(
        (a) =>
          a.sku.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [articles, term]);

  async function handleFiles(fileList: FileList | null, auto = false) {
    if (!fileList) return;
    if (!auto && !selected) return;
    setBusy(true);
    for (const file of Array.from(fileList)) {
      setStatuses((prev) => [{ file: file.name, state: "läuft" }, ...prev]);
      // Bei automatischer Zuordnung den Artikel aus dem Dateinamen lesen.
      const target = auto ? articleFromFileName(file.name, articles) : selected;
      if (!target) {
        setStatuses((prev) =>
          prev.map((entry) =>
            entry.file === file.name && entry.state === "läuft"
              ? {
                  file: file.name,
                  state: "fehler",
                  message: "Kein Artikel zum Dateinamen gefunden",
                }
              : entry,
          ),
        );
        continue;
      }
      try {
        // Marketingbilder sind oft sehr groß — vor dem Upload verkleinern.
        const prepared = await resizeForShop(file);
        const note = prepared.resized
          ? `${formatBytes(prepared.originalBytes)} → ${formatBytes(prepared.bytes.byteLength)} (${prepared.width}×${prepared.height})`
          : `${formatBytes(prepared.originalBytes)} (unverändert)`;
        const result = await uploadArticleImageFn({
          data: {
            articleId: target.id,
            fileName: prepared.fileName,
            mimeType: prepared.mimeType,
            contentBase64: toBase64(prepared.bytes),
          },
        });

        // Vom ersten Bild (_1) zusätzlich ein kleines Vorschaubild für die Liste ablegen.
        let thumbNote = "";
        if (result.ok && articleNumberFromFileName(file.name).imageNo === "1") {
          try {
            const small = await resizeForShop(file, THUMB_EDGE);
            const thumbResult = await uploadArticleImageFn({
              data: {
                articleId: target.id,
                fileName: thumbFileName(small.fileName),
                mimeType: small.mimeType,
                contentBase64: toBase64(small.bytes),
              },
            });
            if (thumbResult.ok) {
              thumbNote = ` · Vorschaubild ${formatBytes(small.bytes.byteLength)} (${small.width}×${small.height})`;
            }
          } catch {
            /* Vorschaubild ist optional. */
          }
        }

        setStatuses((prev) =>
          prev.map((entry) =>
            entry.file === file.name && entry.state === "läuft"
              ? result.ok
                ? {
                    file: file.name,
                    state: "fertig",
                    message: `${target.sku} · ${note}${result.replaced ? " · vorhandenes Bild ersetzt" : ""}`,
                  }
                : { file: file.name, state: "fehler", message: result.error }
              : entry,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload fehlgeschlagen";
        setStatuses((prev) =>
          prev.map((entry) =>
            entry.file === file.name && entry.state === "läuft"
              ? { file: file.name, state: "fehler", message }
              : entry,
          ),
        );
      }
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <Link to="/" className="label-mono text-muted-foreground hover:text-accent">
        ← Zurück zum Katalog
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Artikelbilder</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Artikel auswählen, Fotos hinzufügen. Die Bilder werden im MAWA-Backend als Anhang zum
        Artikel gespeichert und erscheinen danach im Katalog.
      </p>

      <section className="mt-8 rounded-sm border border-accent/40 bg-accent/5 p-4">
        <p className="label-mono text-accent">Schnellweg — Zuordnung über den Dateinamen</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Beginnt der Dateiname mit der Artikelnummer, wird der Artikel automatisch erkannt —
          z. B. <span className="font-mono">600-441-139-nx4m-25-lrf_4.png</span> → Artikel
          600-441-139, oder <span className="font-mono">6046-lampe_2.jpg</span> → Artikel 6046.
          Die Zahl nach dem letzten „_" ist die Bildnummer. Mehrere Fotos für verschiedene Artikel
          können gemeinsam hochgeladen werden.
        </p>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(event) => void handleFiles(event.target.files, true)}
          className="mt-3 block w-full text-sm"
        />
      </section>

      <label className="label-mono mt-10 block text-muted-foreground" htmlFor="article-search">
        Alternativ: Artikel manuell auswählen (Nummer oder Name)
      </label>
      <input
        id="article-search"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setSelected(null);
        }}
        placeholder="z. B. 6046 oder Nitecore"
        className="mt-2 w-full rounded-sm border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {!selected && matches.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-sm border border-border bg-panel">
          {matches.map((article) => (
            <li key={article.id}>
              <button
                onClick={() => {
                  setSelected(article);
                  setTerm(`${article.sku} — ${article.name}`);
                }}
                className="flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-accent/10"
              >
                <span className="font-mono text-[12px] text-muted-foreground">{article.sku}</span>
                <span>{article.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="label-mono mt-8 text-muted-foreground">Fotos zum gewählten Artikel</p>
      <div className="mt-2 rounded-sm border border-border bg-panel p-4">
        {selected ? (
          <>
            <p className="flex flex-wrap items-baseline gap-2 text-sm">
              <span>
                Ausgewählt: <strong>{selected.name}</strong>
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">
                ({selected.sku} · ID {selected.id})
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setTerm("");
                }}
                className="label-mono text-accent hover:underline"
              >
                Auswahl ändern
              </button>
            </p>
            {(images?.[selected.id]?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {images?.[selected.id]?.map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt={`Vorhandenes Foto zu ${selected.name}`}
                    className="h-16 w-16 rounded-sm border border-border object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bitte oben zuerst einen Artikel aus der Liste anklicken.
          </p>
        )}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy || !selected}
          onChange={(event) => void handleFiles(event.target.files)}
          className="mt-3 block w-full text-sm disabled:opacity-40"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Mehrere Fotos gleichzeitig möglich, JPG/PNG/WebP. Große Bilder werden vor dem Upload
          automatisch auf max. {MAX_EDGE} px Kantenlänge verkleinert und komprimiert.
        </p>
      </div>

      {statuses.length > 0 && (
        <ul className="mt-6 space-y-1 text-sm">
          {statuses.map((entry, index) => (
            <li key={`${entry.file}-${index}`} className="flex gap-2">
              <span className="font-mono text-[12px] text-muted-foreground">{entry.file}</span>
              <span
                className={
                  entry.state === "fehler"
                    ? "text-destructive"
                    : entry.state === "fertig"
                      ? "text-accent"
                      : "text-muted-foreground"
                }
              >
                {entry.state}
                {entry.message ? `: ${entry.message}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
