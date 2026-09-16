import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { getCatalog, type CatalogArticle } from "@/lib/catalog.functions";
import { uploadArticleImageFn } from "@/lib/article-images.functions";
import { getShopUser } from "@/lib/shop-auth.functions";

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

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

function ImageAdmin() {
  const { articles } = Route.useLoaderData();
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<CatalogArticle | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return articles
      .filter(
        (a) =>
          a.sku.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [articles, term]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !selected) return;
    setBusy(true);
    for (const file of Array.from(fileList)) {
      setStatuses((prev) => [{ file: file.name, state: "läuft" }, ...prev]);
      try {
        // Marketingbilder sind oft sehr groß — vor dem Upload verkleinern.
        const prepared = await resizeForShop(file);
        const note = prepared.resized
          ? `${formatBytes(prepared.originalBytes)} → ${formatBytes(prepared.bytes.byteLength)} (${prepared.width}×${prepared.height})`
          : `${formatBytes(prepared.originalBytes)} (unverändert)`;
        const result = await uploadArticleImageFn({
          data: {
            articleId: selected.id,
            fileName: prepared.fileName,
            mimeType: prepared.mimeType,
            contentBase64: toBase64(prepared.bytes),
          },
        });
        setStatuses((prev) =>
          prev.map((entry) =>
            entry.file === file.name && entry.state === "läuft"
              ? result.ok
                ? { file: file.name, state: "fertig", message: note }
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

      <label className="label-mono mt-8 block text-muted-foreground" htmlFor="article-search">
        Artikel suchen (Nummer oder Name)
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

      {selected && (
        <div className="mt-6 rounded-sm border border-border bg-panel p-4">
          <p className="text-sm">
            Ausgewählt: <strong>{selected.name}</strong>{" "}
            <span className="font-mono text-[12px] text-muted-foreground">
              ({selected.sku} · ID {selected.id})
            </span>
          </p>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(event) => void handleFiles(event.target.files)}
            className="mt-3 block w-full text-sm"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Mehrere Fotos gleichzeitig möglich, JPG/PNG/WebP.
          </p>
        </div>
      )}

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
