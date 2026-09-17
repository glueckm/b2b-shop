import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { z } from "zod";

import heroImage from "@/assets/hero-fuchs.jpg";
import mawaLogo from "@/assets/mawa-logo-white.png";
import { articleImages } from "@/lib/article-images";
import { getCatalog, priceGroups, type CatalogArticle } from "@/lib/catalog.functions";
import { getShopUser, shopLogout } from "@/lib/shop-auth.functions";

const searchSchema = z.object({
  channel: z.string().default("NET1"),
  category: z.string().default(""),
  subcategory: z.string().default(""),
  subsubcategory: z.string().default(""),
  q: z.string().default(""),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [catalog, user] = await Promise.all([
      getCatalog({
        data: {
          channel: deps.channel,
          category: deps.category,
          subcategory: deps.subcategory,
          subsubcategory: deps.subsubcategory,
          search: deps.q,
        },
      }),
      getShopUser().catch(() => null),
    ]);
    return { ...catalog, user };
  },


  head: () => ({
    meta: [
      { title: "MAWA Trading B2B Shop — Distribution Optik & Zubehör" },
      {
        name: "description",
        content:
          "MAWA Trading Distribution: Wärmebild- und Nachtsichttechnik, Montagen und Zubehör mit tagesaktuellen Lagerbeständen und Ihrer Preisgruppe.",
      },
      { property: "og:title", content: "MAWA Trading B2B Shop — Distributionskatalog" },
      {
        property: "og:description",
        content: "Nettopreise, Preisgruppen und Lagerbestände für Partner der MAWA Distribution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: () => (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-2xl font-semibold">Katalog nicht erreichbar</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Die Verbindung zur Artikeldatenbank ist fehlgeschlagen. Bitte Seite neu laden.
      </p>
    </div>
  ),
  notFoundComponent: () => <div className="px-5 py-24 text-center">Nicht gefunden</div>,
  component: Shop,
});

type Line = { sku: string; qty: number };

const eur = (value: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);

const num = (value: number) => value.toLocaleString("de-DE");

/** Lagerstand nur bis 10 ausweisen, darüber "10+". */
const stockDisplay = (onHand: number) => (onHand > 10 ? "10+" : num(onHand));


const entities: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** HTML-Beschreibung als einzeiliger Klartext (für die Tabelle). */
function specText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => entities[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Entfernt Skripte, Event-Handler und gefährliche URLs aus der HTML-Beschreibung. */
function sanitizeSpec(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|link|meta)[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'>]*("|')?/gi, "");
}


function priceForQty(article: CatalogArticle, qty: number) {
  let price = article.breaks[0]?.price ?? 0;
  for (const b of article.breaks) if (qty >= b.from) price = b.price;
  return price;
}

function stockState(onHand: number) {
  if (onHand <= 0) return "backorder" as const;
  if (onHand < 5) return "low" as const;
  return "in" as const;
}

const stockLabel = { in: "Auf Lager", low: "Wenig Bestand", backorder: "Nicht lagernd" };
const stockTone = { in: "text-stock", low: "text-low", backorder: "text-muted-foreground" };
const stockDot = { in: "bg-stock", low: "bg-low", backorder: "bg-muted-foreground" };

function Shop() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();

  const articles = data.articles;
  /** Bilder aus dem MAWA-Backend, ergänzt um lokal abgelegte Dateien. */
  const imagesOf = (article: { id: string; sku: string }) => {
    const remote = data.images[article.id] ?? [];
    return remote.length > 0 ? remote : articleImages(article.id, article.sku);
  };
  /** Lädt alle Artikelbilder als Dateien herunter. */
  const downloadPhotos = async (article: { id: string; sku: string }) => {
    const urls = imagesOf(article);
    for (let index = 0; index < urls.length; index += 1) {
      try {
        const response = await fetch(urls[index]!);
        if (!response.ok) continue;
        const blob = await response.blob();
        const extension = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `${article.sku}_${index + 1}.${extension}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
      } catch {
        // einzelnes Bild überspringen
      }
    }
  };
  const [qty, setQty] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [quick, setQuick] = useState("");
  const [term, setTerm] = useState(search.q);
  const [detailSku, setDetailSku] = useState<string | null>(null);
  const [scopeArticle, setScopeArticle] = useState<CatalogArticle | null>(null);
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
    title: string;
  } | null>(null);
  const stepLightbox = (delta: number) =>
    setLightbox((current) =>
      current
        ? {
            ...current,
            index: (current.index + delta + current.images.length) % current.images.length,
          }
        : current,
    );

  const bySku = useMemo(() => new Map(articles.map((a) => [a.sku, a])), [articles]);


  /** Ebene-2-Kategorien der aktuell gewählten Ebene-1-Kategorie. */
  const subCategories = useMemo(
    () =>
      (data.categoryTree ?? []).find((node) => node.name === search.category)?.children ?? [],
    [data.categoryTree, search.category],
  );

  /** Ebene-3-Kategorien der aktuell gewählten Ebene-2-Kategorie. */
  const subSubCategories = useMemo(
    () => subCategories.find((child) => child.name === search.subcategory)?.children ?? [],
    [subCategories, search.subcategory],
  );


  /** Variantenartikel (Mutter) als eine Zeile, Einzelartikel im Drill-down. */
  const rows = useMemo(() => {
    type Row =
      | { kind: "single"; article: CatalogArticle }
      | { kind: "group"; id: string; sku: string; name: string; variants: CatalogArticle[] };
    const out: Row[] = [];
    const groups = new Map<string, Extract<Row, { kind: "group" }>>();
    for (const article of articles) {
      if (!article.groupId) {
        out.push({ kind: "single", article });
        continue;
      }
      let group = groups.get(article.groupId);
      if (!group) {
        group = {
          kind: "group",
          id: article.groupId,
          sku: article.groupSku || article.groupId,
          name: article.groupName || article.name,
          variants: [],
        };
        groups.set(article.groupId, group);
        out.push(group);
      }
      group.variants.push(article);
    }
    for (const group of groups.values()) {
      group.variants.sort((a, b) => a.sku.localeCompare(b.sku));
    }
    return out;
  }, [articles]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));



  const activeGroup =
    priceGroups.find((g) => g.channel === search.channel) ?? priceGroups[0]!;


  const getQty = (article: CatalogArticle) => qty[article.sku] ?? article.moq;

  const step = (article: CatalogArticle, delta: number) =>
    setQty((prev) => ({
      ...prev,
      [article.sku]: Math.max(article.moq, getQty(article) + delta * article.moq),
    }));

  const addLine = (sku: string, amount: number) =>
    setLines((prev) => {
      const existing = prev.find((l) => l.sku === sku);
      if (existing) return prev.map((l) => (l.sku === sku ? { ...l, qty: l.qty + amount } : l));
      return [...prev, { sku, qty: amount }];
    });

  const removeLine = (sku: string) => setLines((prev) => prev.filter((l) => l.sku !== sku));

  /** Menge einer Warenkorbposition um eine Mindestbestellmenge erhöhen/verringern. */
  const stepLine = (sku: string, delta: number, moq: number) =>
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.sku !== sku) return [l];
        const next = l.qty + delta * Math.max(1, moq);
        return next < Math.max(1, moq) ? [] : [{ ...l, qty: next }];
      }),
    );

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    void navigate({ search: (prev) => ({ ...prev, q: term.trim() }) });
  };

  const submitQuick = (event: React.FormEvent) => {
    event.preventDefault();
    const [rawSku, rawQty] = quick.split(/[\s,]+/);
    const article = articles.find(
      (a) => a.sku.toLowerCase() === (rawSku ?? "").trim().toLowerCase(),
    );
    if (!article) return;
    addLine(article.sku, Math.max(article.moq, Number(rawQty) || article.moq));
    setQuick("");
  };

  const detailedLines = lines.flatMap((line) => {
    const article = bySku.get(line.sku);
    if (!article) return [];
    const unit = priceForQty(article, line.qty);
    return [{ ...line, article, unit, total: unit * line.qty }];
  });

  const subtotal = detailedLines.reduce((sum, l) => sum + l.total, 0);
  const listTotal = detailedLines.reduce(
    (sum, l) => sum + (l.article.breaks[0]?.price ?? 0) * l.qty,
    0,
  );
  const savings = Math.max(0, listTotal - subtotal);

  /** Artikelzeile — `nested` für Varianten innerhalb eines Variantenartikels. */
  const ArticleRow = ({
    article,
    nested = false,
  }: {
    article: CatalogArticle;
    nested?: boolean;
  }) => {
    const q = getQty(article);
    const unit = priceForQty(article, q);
    const state = stockState(article.onHand);
    const spec = specText(article.spec);
    // Kleines Vorschaubild bevorzugen, damit die Liste leicht bleibt.
    const thumb = data.thumbs?.[article.id] ?? imagesOf(article)[0];
    const open = detailSku === article.sku;
    const toggleDetail = () => setDetailSku(open ? null : article.sku);
    return (
      <Fragment>
        <tr
          onClick={toggleDetail}
          className={`cursor-pointer border-t border-border/70 hover:bg-muted/40 ${nested ? "bg-card" : ""}`}
        >
          <td className={`px-3 pt-3 align-top ${nested ? "pl-8" : ""}`}>
            <button
              onClick={toggleDetail}
              className="font-mono text-[12px] text-muted-foreground hover:text-accent"
            >
              {article.sku}
            </button>
          </td>
          <td className="max-w-[320px] px-3 pt-3 align-top">
            <span className="flex items-start gap-3">
              {thumb ? (
                <img
                  src={thumb}
                  alt={article.name}
                  loading="lazy"
                  className="size-11 shrink-0 rounded-sm border border-border bg-panel object-contain p-0.5"
                />
              ) : (
                <span className="grid size-11 shrink-0 place-items-center rounded-sm border border-dashed border-border font-mono text-[10px] text-muted-foreground">
                  —
                </span>
              )}
              <button onClick={toggleDetail} className="text-left">
                <span className="block font-semibold">{article.name}</span>
              </button>
            </span>
          </td>
          <td className="px-3 pt-3 align-top font-mono text-[13px] font-semibold">{eur(unit)}</td>
          <td className="px-3 pt-3 align-top font-mono text-[12px] text-muted-foreground">
            {article.unit}
          </td>
          <td className="px-3 pt-3 align-top font-mono text-[12px] text-muted-foreground">
            {article.moq}
          </td>
          <td className="px-3 pt-3 align-top">
            <span className={`flex items-center gap-1.5 text-xs font-medium ${stockTone[state]}`}>
              <span className={`size-1.5 rounded-full ${stockDot[state]}`} />
              {stockLabel[state]}
              {article.onHand > 0 && (
                <span className="font-mono text-muted-foreground">
                  {stockDisplay(article.onHand)}
                </span>
              )}
            </span>
            {article.onHand <= 0 && (
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                bestellbar · Lieferung bei Zugang
              </span>
            )}
          </td>

          <td className="px-3 pt-3 align-top" onClick={(event) => event.stopPropagation()}>
            <span className="flex w-max items-center rounded-sm border border-border">
              <button
                onClick={() => step(article, -1)}
                aria-label={`Menge verringern ${article.sku}`}
                className="grid size-8 place-items-center font-mono text-muted-foreground hover:text-foreground"
              >
                −
              </button>
              <span className="w-12 text-center font-mono text-[13px]">{q}</span>
              <button
                onClick={() => step(article, 1)}
                aria-label={`Menge erhöhen ${article.sku}`}
                className="grid size-8 place-items-center font-mono text-muted-foreground hover:text-foreground"
              >
                +
              </button>
            </span>
          </td>
          <td className="px-3 pt-3 align-top" onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => addLine(article.sku, q)}
              className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Hinzufügen
            </button>
          </td>
        </tr>
        <tr
          onClick={toggleDetail}
          className={`cursor-pointer hover:bg-muted/40 ${nested ? "bg-card" : ""}`}
        >
          <td />
          <td colSpan={7} className="px-3 pb-3 pt-1">
            <span className="line-clamp-2 block text-xs text-muted-foreground">
              {spec || article.category}
            </span>
          </td>
        </tr>
        {open && (
          <tr className="bg-muted/30">
            <td />
            <td colSpan={7} className="px-3 pb-4 pt-1">
              <div className="float-right ml-4 w-[190px]">
                <button
                  onClick={() => setScopeArticle(article)}
                  disabled={!article.scope}
                  className="w-full rounded-sm border border-accent bg-accent px-3 py-2 text-left text-xs font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Lieferumfang anzeigen
                  <span className="mt-0.5 block text-[11px] font-normal text-accent-foreground/75">
                    {article.scope ? "Details im Pop-up" : "Kein Langtext hinterlegt"}
                  </span>
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    void downloadPhotos(article);
                  }}
                  disabled={imagesOf(article).length === 0}
                  className="mt-2 w-full rounded-sm border border-accent bg-accent px-3 py-2 text-left text-xs font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Foto Download
                  <span className="mt-0.5 block text-[11px] font-normal text-accent-foreground/75">
                    {imagesOf(article).length > 0
                      ? `${imagesOf(article).length} Bild(er) speichern`
                      : "Keine Bilder vorhanden"}
                  </span>
                </button>
              </div>
              {imagesOf(article).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {imagesOf(article).map((src, index) => (
                    <button
                      key={src}
                      onClick={() =>
                        setLightbox({
                          images: imagesOf(article),
                          index,
                          title: `${article.sku} · ${article.name}`,
                        })
                      }
                      aria-label={`Bild ${index + 1} vergrößern`}
                      className="rounded-sm border border-border bg-panel p-0.5 transition-colors hover:border-accent"
                    >
                      <img
                        src={src}
                        alt={`${article.name} — Bild ${index + 1}`}
                        loading="lazy"
                        className="h-20 w-20 object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}

              {article.spec && (
                <div
                  className="spec-html mt-2 text-[13px] text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: sanitizeSpec(article.spec) }}
                />
              )}

              {article.rebatePct > 0 && (
                <p className="mt-3 text-[12px] text-stock">
                  Preise inkl. {article.rebatePct} % Konditionsrabatt Ihrer Preisgruppe für die
                  Warengruppe {article.category}
                </p>
              )}

              {article.breaks.length > 1 && (
              <table className="mt-3 w-full max-w-[520px] text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="label-mono py-1.5 font-medium text-muted-foreground">
                      Ab Menge
                    </th>
                    <th className="label-mono py-1.5 text-right font-medium text-muted-foreground">
                      Netto/Einheit
                    </th>
                    <th className="label-mono py-1.5 text-right font-medium text-muted-foreground">
                      Position ab Staffel
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[13px]">
                  {article.breaks.map((tier, index) => {
                    const best = index === article.breaks.length - 1 && article.breaks.length > 1;
                    const from = Math.max(tier.from, article.moq);
                    return (
                      <tr key={tier.from} className="border-b border-border/70 last:border-0">
                        <td className="py-1.5">
                          {from} {article.unit}
                        </td>
                        <td
                          className={`py-1.5 text-right ${best ? "font-semibold text-stock" : ""}`}
                        >
                          {eur(tier.price)}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {eur(tier.price * from)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              )}
            </td>
          </tr>
        )}

      </Fragment>
    );
  };



  return (
    <div className="min-h-screen bg-background">
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") stepLightbox(1);
            if (event.key === "ArrowLeft") stepLightbox(-1);
            if (event.key === "Escape") setLightbox(null);
          }}
          tabIndex={-1}
          ref={(node) => node?.focus()}
        >
          <div className="flex items-center justify-between gap-4 text-primary-foreground">
            <p className="font-mono text-[12px] opacity-80">
              {lightbox.title} · Bild {lightbox.index + 1}/{lightbox.images.length}
            </p>
            <button
              onClick={() => setLightbox(null)}
              aria-label="Schließen"
              className="grid size-9 place-items-center rounded-sm border border-white/30 text-lg hover:border-white"
            >
              ×
            </button>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {lightbox.images.length > 1 && (
              <button
                onClick={() => stepLightbox(-1)}
                aria-label="Vorheriges Bild"
                className="grid size-11 shrink-0 place-items-center rounded-sm border border-white/30 text-xl text-primary-foreground hover:border-white"
              >
                ‹
              </button>
            )}
            <img
              src={lightbox.images[lightbox.index]}
              alt={`${lightbox.title} — Bild ${lightbox.index + 1}`}
              className="max-h-full max-w-full object-contain"
            />
            {lightbox.images.length > 1 && (
              <button
                onClick={() => stepLightbox(1)}
                aria-label="Nächstes Bild"
                className="grid size-11 shrink-0 place-items-center rounded-sm border border-white/30 text-xl text-primary-foreground hover:border-white"
              >
                ›
              </button>
            )}
          </div>
          {lightbox.images.length > 1 && (
            <div
              className="mt-3 flex flex-wrap justify-center gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              {lightbox.images.map((src, index) => (
                <button
                  key={src}
                  onClick={() => setLightbox({ ...lightbox, index })}
                  aria-label={`Bild ${index + 1} anzeigen`}
                  className={`rounded-sm border p-0.5 ${
                    index === lightbox.index ? "border-accent" : "border-white/25"
                  }`}
                >
                  <img src={src} alt="" className="h-14 w-14 object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {scopeArticle && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setScopeArticle(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-sm border border-border bg-card p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label-mono text-muted-foreground">Lieferumfang</p>
                <h2 className="mt-1 text-sm font-semibold">{scopeArticle.name}</h2>
                <p className="font-mono text-[12px] text-muted-foreground">{scopeArticle.sku}</p>
              </div>
              <button
                onClick={() => setScopeArticle(null)}
                aria-label="Schließen"
                className="grid size-8 place-items-center rounded-sm border border-border text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            <div
              className="spec-html mt-4 text-[13px] text-foreground"
              dangerouslySetInnerHTML={{ __html: sanitizeSpec(scopeArticle.scope) }}
            />
          </div>
        </div>
      )}
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-5 py-3">
          <div className="flex items-center gap-3">
            <img
              src={mawaLogo}
              alt="MAWA Trading"
              width={369}
              height={77}
              className="h-8 w-auto"
            />
            <span className="label-mono hidden text-primary-foreground/55 sm:block">
              Distribution B2B
            </span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <label className="hidden items-center gap-2 sm:flex">
              <span className="label-mono text-primary-foreground/55">Preisgruppe</span>
              <select
                value={activeGroup.channel}
                onChange={(event) =>
                  void navigate({
                    search: (prev) => ({ ...prev, channel: event.target.value }),
                  })
                }
                className="rounded-sm bg-primary-foreground/10 px-2 py-1.5 text-xs font-semibold text-primary-foreground outline-none"
              >
                {priceGroups.map((group) => (
                  <option key={group.channel} value={group.channel} className="text-foreground">
                    {group.label}
                  </option>
                ))}
              </select>
            </label>
            {data.user ? (
              <div className="flex items-center gap-3">
                <Link
                  to="/bilder"
                  className="label-mono text-primary-foreground/70 hover:text-accent"
                >
                  Bilder
                </Link>
                <span className="label-mono text-primary-foreground/70">
                  {data.user.firstName ?? data.user.email}
                </span>
                <button
                  onClick={async () => {
                    await shopLogout({});
                    await router.invalidate();
                  }}
                  className="label-mono text-primary-foreground/70 hover:text-accent"
                >
                  Abmelden
                </button>
              </div>
            ) : (
              <Link
                to="/anmelden"
                className="rounded-sm border border-primary-foreground/25 px-3 py-2 text-sm font-semibold text-primary-foreground hover:border-accent hover:text-accent"
              >
                Anmelden
              </Link>
            )}
            <a
              href="#order"
              className="flex items-center gap-2 rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground"
            >
              Warenkorb
              <span className="font-mono text-xs">{lines.length}</span>
            </a>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden border-b border-border">
        <img
          src={heroImage}
          alt="Fuchs im nebligen Herbstwald bei Sonnenaufgang"
          width={1600}
          height={912}
          className="absolute inset-0 size-full object-cover object-[50%_30%]"
        />
        <div className="absolute inset-0 bg-primary/80" />
        <div className="relative mx-auto max-w-[1440px] px-5 py-14">
          <p className="label-mono text-accent">Distributionsportal · Nettopreise</p>
          <h1 className="mt-3 whitespace-nowrap text-3xl font-bold leading-[1.1] tracking-tight text-primary-foreground lg:text-4xl">
            Für Profis gemacht. Für Ihren Betrieb gedacht.
          </h1>
        </div>
      </section>

      <nav className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-5">
          {[{ name: "", count: data.stats.articles }, ...data.categories].map((category) => {
            const active = category.name === search.category;
            return (
              <button
                key={category.name || "all"}
                onClick={() => {
                  // Suchbegriff zurücksetzen, damit die Kategorie vollständig angezeigt wird.
                  setTerm("");
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      category: active ? "" : category.name,
                      subcategory: "",
                      subsubcategory: "",
                      q: "",
                    }),
                  });
                }}

                className={`whitespace-nowrap border-b-2 px-4 py-3.5 text-[16px] tracking-tight transition-colors ${
                  active
                    ? "border-accent bg-accent/15 font-bold text-accent"
                    : "border-transparent font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {category.name || "Alle Artikel"}
              </button>
            );
          })}
        </div>

        {subCategories.length > 0 && (
          <div className="border-t border-border bg-card">
            <div className="mx-auto flex max-w-[1440px] items-center gap-2 overflow-x-auto px-5 py-2">
              <span className="label-mono whitespace-nowrap text-muted-foreground">
                {search.category}
              </span>
              <button
                onClick={() => {
                  setTerm("");
                  void navigate({
                    search: (prev) => ({ ...prev, subcategory: "", subsubcategory: "", q: "" }),
                  });
                }}

                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] transition-colors ${
                  search.subcategory === ""
                    ? "bg-accent/15 font-semibold text-accent"
                    : "bg-panel font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Alle
              </button>
              {subCategories.map((sub) => {
                const active = sub.name === search.subcategory;
                return (
                  <button
                    key={sub.name}
                    onClick={() => {
                      setTerm("");
                      void navigate({
                        search: (prev) => ({
                          ...prev,
                          subcategory: active ? "" : sub.name,
                          subsubcategory: "",
                          q: "",
                        }),
                      });
                    }}

                    className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] transition-colors ${
                      active
                        ? "bg-accent/15 font-semibold text-accent"
                        : "bg-panel font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {sub.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {subSubCategories.length > 0 && (
          <div className="border-t border-border bg-muted/40">
            <div className="mx-auto flex max-w-[1440px] items-center gap-2 overflow-x-auto px-5 py-2">
              <span className="label-mono whitespace-nowrap text-muted-foreground">
                {search.subcategory}
              </span>
              <button
                onClick={() => {
                  setTerm("");
                  void navigate({ search: (prev) => ({ ...prev, subsubcategory: "", q: "" }) });
                }}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] transition-colors ${
                  search.subsubcategory === ""
                    ? "bg-stock/20 font-semibold text-stock"
                    : "bg-card font-medium text-muted-foreground hover:bg-stock/10 hover:text-stock"
                }`}
              >
                Alle
              </button>
              {subSubCategories.map((leaf) => {
                const active = leaf.name === search.subsubcategory;
                return (
                  <button
                    key={leaf.name}
                    onClick={() => {
                      setTerm("");
                      void navigate({
                        search: (prev) => ({
                          ...prev,
                          subsubcategory: active ? "" : leaf.name,
                          q: "",
                        }),
                      });
                    }}
                    className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] transition-colors ${
                      active
                        ? "bg-stock/20 font-semibold text-stock"
                        : "bg-card font-medium text-muted-foreground hover:bg-stock/10 hover:text-stock"
                    }`}
                  >
                    {leaf.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

      </nav>

      <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-7 lg:grid-cols-[minmax(0,1fr)_330px]">
        <main className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="catalog" className="text-2xl font-semibold tracking-tight">
                {search.subcategory || search.category || "Alle Artikel"}
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                {num(data.total)} Treffer · {rows.length} angezeigt · Preise netto ohne USt.
              </p>
            </div>
            <form onSubmit={submitSearch} className="flex items-center gap-2">
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Artikelnummer oder Name"
                aria-label="Katalog durchsuchen"
                className="w-56 rounded-sm border border-border bg-card px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                className="rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
              >
                Suchen
              </button>
            </form>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/60">
                  {[
                    "Artikelnr.",
                    "Artikel",
                    "Netto/Einheit",
                    "Einheit",
                    "Mind.",
                    "Bestand",
                    "Menge",
                    "",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="label-mono px-3 py-2.5 font-medium text-muted-foreground"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-sm">
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      {search.q
                        ? `Keine Treffer für „${search.q}“ in dieser Auswahl.`
                        : "Keine Artikel für diese Auswahl."}
                    </td>

                  </tr>
                )}
                {rows.map((row) =>
                  row.kind === "single" ? (
                    <ArticleRow key={row.article.sku} article={row.article} />
                  ) : (
                    <Fragment key={`g-${row.id}`}>
                      <tr className="border-t border-border/70 bg-muted/30">
                        <td className="px-3 py-3 align-top">
                          <button
                            onClick={() => toggleGroup(row.id)}
                            className="font-mono text-[12px] text-muted-foreground hover:text-accent"
                          >
                            {row.sku}
                          </button>
                        </td>
                        <td className="max-w-[320px] px-3 py-3 align-top">
                          <button
                            onClick={() => toggleGroup(row.id)}
                            className="flex items-start gap-3 text-left"
                          >
                            <span className="grid size-11 shrink-0 place-items-center rounded-sm border border-border bg-panel font-mono text-[13px] text-muted-foreground">
                              {openGroups[row.id] ? "−" : "+"}
                            </span>
                            <span>
                              <span className="block font-semibold">{row.name}</span>
                              <span className="label-mono text-muted-foreground">
                                {row.variants.length} Varianten
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3 align-top font-mono text-[13px] font-semibold">
                          ab {eur(Math.min(...row.variants.map((v) => priceForQty(v, v.moq))))}
                        </td>
                        <td className="px-3 py-3 align-top font-mono text-[12px] text-muted-foreground">
                          {row.variants[0]?.unit}
                        </td>
                        <td className="px-3 py-3" />
                        <td className="px-3 py-3 align-top">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-stock">
                            <span className="size-1.5 rounded-full bg-stock" />
                            {row.variants.filter((v) => v.onHand > 0).length} von{" "}
                            {row.variants.length} Varianten lagernd
                          </span>
                        </td>

                        <td className="px-3 py-3" />
                        <td className="px-3 py-3 align-top">
                          <button
                            onClick={() => toggleGroup(row.id)}
                            className="rounded-sm border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent hover:text-accent"
                          >
                            {openGroups[row.id] ? "Schließen" : "Varianten"}
                          </button>
                        </td>
                      </tr>
                      {openGroups[row.id] &&
                        row.variants.map((variant) => (
                          <ArticleRow key={variant.sku} article={variant} nested />
                        ))}
                    </Fragment>
                  ),
                )}

              </tbody>
            </table>
          </div>
        </main>

        <aside id="order" className="lg:sticky lg:top-5 lg:self-start">
          <div className="rounded-lg border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="label-mono text-muted-foreground">Warenkorb</span>
              <span className="font-mono text-[11px] text-accent">
                {detailedLines.length} Positionen
              </span>
            </div>

            <form onSubmit={submitQuick} className="border-b border-border px-4 py-3">
              <label className="block text-xs font-medium text-muted-foreground" htmlFor="quick">
                Schnellerfassung — Artikelnr. + Menge
              </label>
              <div className="mt-1.5 flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2">
                <input
                  id="quick"
                  value={quick}
                  onChange={(event) => setQuick(event.target.value)}
                  placeholder="200-200-022 10"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground"
                />
                <button type="submit" className="text-sm font-semibold text-accent">
                  Add
                </button>
              </div>
            </form>

            <ul>
              {detailedLines.length === 0 && (
                <li className="px-4 py-6 text-sm text-muted-foreground">
                  Noch keine Positionen. Artikel aus dem Katalog hinzufügen.
                </li>
              )}
              {detailedLines.map((line) => (
                <li
                  key={line.sku}
                  className="flex items-start gap-3 border-b border-border/70 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {line.sku}
                      </span>
                      <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        <button
                          onClick={() => stepLine(line.sku, -1, line.article.moq)}
                          aria-label={`${line.sku} Menge verringern`}
                          className="flex size-5 items-center justify-center rounded-sm border border-border text-foreground hover:border-accent hover:text-accent"
                        >
                          −
                        </button>
                        <span className="min-w-[2ch] text-center text-foreground">{line.qty}</span>
                        <button
                          onClick={() => stepLine(line.sku, 1, line.article.moq)}
                          aria-label={`${line.sku} Menge erhöhen`}
                          className="flex size-5 items-center justify-center rounded-sm border border-border text-foreground hover:border-accent hover:text-accent"
                        >
                          +
                        </button>
                        × {eur(line.unit)}
                      </span>
                    </div>
                    <p className="truncate text-[13px] font-medium">{line.article.name}</p>
                    <p className="mt-0.5 font-mono text-[13px] font-semibold text-accent">
                      {eur(line.total)}
                    </p>
                  </div>
                  <button
                    onClick={() => removeLine(line.sku)}
                    aria-label={`${line.sku} entfernen`}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="px-4 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Zwischensumme (netto)</span>
                <span className="font-mono font-semibold">{eur(subtotal)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Staffelvorteil</span>
                <span className="font-mono font-semibold text-stock">−{eur(savings)}</span>
              </div>
              <button className="mt-4 w-full rounded-sm bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground">
                Bestellung absenden
              </button>
              <button className="mt-2 w-full rounded-sm border border-border px-4 py-1.5 text-sm font-semibold text-foreground hover:bg-muted">
                Stattdessen Angebot anfragen
              </button>
              <p className="label-mono mt-3 text-muted-foreground">
                Preise gemäß Preisgruppe {activeGroup.label} · netto
              </p>
            </div>
          </div>
        </aside>
      </div>

      <footer className="border-t border-border bg-panel">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
          <span>MAWA Trading · Distributor · Belieferung ausschließlich B2B</span>
          <span className="font-mono text-[12px]">Bestände und Preise live aus dem ERP</span>
        </div>
      </footer>
    </div>
  );
}
