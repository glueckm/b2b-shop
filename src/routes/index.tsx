import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { z } from "zod";

import heroImage from "@/assets/warehouse-hero.jpg";
import mawaLogo from "@/assets/mawa-logo.png";
import { articleImages } from "@/lib/article-images";
import { getCatalog, priceGroups, type CatalogArticle } from "@/lib/catalog.functions";
import { getShopUser, shopLogout } from "@/lib/shop-auth.functions";

const searchSchema = z.object({
  channel: z.string().default("NET1"),
  category: z.string().default(""),
  subcategory: z.string().default(""),
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

const stockLabel = { in: "Auf Lager", low: "Wenig Bestand", backorder: "Nachbestellung" };
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
  const [qty, setQty] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [quick, setQuick] = useState("");
  const [term, setTerm] = useState(search.q);
  const [detailSku, setDetailSku] = useState<string | null>(null);

  const bySku = useMemo(() => new Map(articles.map((a) => [a.sku, a])), [articles]);
  const detail = (detailSku ? bySku.get(detailSku) : undefined) ?? articles[0];

  /** Ebene-2-Kategorien der aktuell gewählten Ebene-1-Kategorie. */
  const subCategories = useMemo(
    () =>
      (data.categoryTree ?? []).find((node) => node.name === search.category)?.children ?? [],
    [data.categoryTree, search.category],
  );

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

  return (
    <div className="min-h-screen bg-background">
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
          alt="MAWA Distributionslager mit palettierter Ware"
          width={1600}
          height={912}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-primary/80" />
        <div className="relative mx-auto max-w-[1440px] px-5 py-14">
          <p className="label-mono text-accent">Distributionsportal · Nettopreise</p>
          <h1 className="mt-3 max-w-[26ch] text-4xl font-bold leading-[1.05] tracking-tight text-primary-foreground text-balance">
            Das komplette MAWA Distributionsprogramm zu Ihrem Konditionspreis.
          </h1>
          <dl className="mt-8 flex flex-wrap gap-x-12 gap-y-4 font-mono text-primary-foreground">
            <div>
              <dt className="label-mono text-primary-foreground/55">Artikel verfügbar</dt>
              <dd className="text-xl font-semibold">{num(data.stats.articles)}</dd>
            </div>
            <div>
              <dt className="label-mono text-primary-foreground/55">Kategorien</dt>
              <dd className="text-xl font-semibold">{num(data.stats.categories)}</dd>
            </div>
            <div>
              <dt className="label-mono text-primary-foreground/55">Lagerstück</dt>
              <dd className="text-xl font-semibold">{num(data.stats.onHand)}</dd>
            </div>
            <div>
              <dt className="label-mono text-primary-foreground/55">Preisgruppe</dt>
              <dd className="text-xl font-semibold">{activeGroup.label}</dd>
            </div>
          </dl>
        </div>
      </section>

      <nav className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-5">
          {[{ name: "", count: data.stats.articles }, ...data.categories].map((category) => {
            const active = category.name === search.category;
            return (
              <button
                key={category.name || "all"}
                onClick={() =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      category: active ? "" : category.name,
                      subcategory: "",
                    }),
                  })
                }
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-[13px] transition-colors ${
                  active
                    ? "border-accent font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {category.name || "Alle Artikel"}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {category.count}
                </span>
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
                onClick={() =>
                  void navigate({ search: (prev) => ({ ...prev, subcategory: "" }) })
                }
                className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] transition-colors ${
                  search.subcategory === ""
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "bg-panel font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                Alle
              </button>
              {subCategories.map((sub) => {
                const active = sub.name === search.subcategory;
                return (
                  <button
                    key={sub.name}
                    onClick={() =>
                      void navigate({
                        search: (prev) => ({ ...prev, subcategory: active ? "" : sub.name }),
                      })
                    }
                    className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] transition-colors ${
                      active
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "bg-panel font-medium text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {sub.name}
                    <span className="ml-2 font-mono text-[11px] opacity-70">{sub.count}</span>
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
                {num(data.total)} Treffer · {articles.length} angezeigt · Preise netto ohne USt.
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

          {detail && (
            <section
              id="detail"
              className="sticky top-0 z-20 mt-4 max-h-[58vh] overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.6)]"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="label-mono text-muted-foreground">
                    Staffelpreise · {activeGroup.label}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold tracking-tight">
                    {detail.name} · {detail.sku}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{detail.category}</p>
                </div>
                <span
                  className={`flex items-center gap-1.5 text-sm font-medium ${stockTone[stockState(detail.onHand)]}`}
                >
                  <span className={`size-2 rounded-full ${stockDot[stockState(detail.onHand)]}`} />
                  {stockLabel[stockState(detail.onHand)]}
                </span>
              </div>

              {imagesOf(detail).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4">
                  {imagesOf(detail).map((src, index) => (
                    <img
                      key={src}
                      src={src}
                      alt={`${detail.name} — Bild ${index + 1}`}
                      loading="lazy"
                      className="h-40 w-40 rounded-sm border border-border bg-panel object-contain p-1"
                    />
                  ))}
                </div>
              )}

              {detail.spec && (
                <div
                  className="spec-html mt-4 border-t border-border pt-4 text-sm text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: sanitizeSpec(detail.spec) }}
                />
              )}

              <table className="mt-4 w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="label-mono py-2 font-medium text-muted-foreground">Ab Menge</th>
                    <th className="label-mono py-2 text-right font-medium text-muted-foreground">
                      Netto/Einheit
                    </th>
                    <th className="label-mono py-2 text-right font-medium text-muted-foreground">
                      Position ab Staffel
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[13px]">
                  {detail.breaks.map((tier, index) => {
                    const best = index === detail.breaks.length - 1 && detail.breaks.length > 1;
                    const from = Math.max(tier.from, detail.moq);
                    return (
                      <tr key={tier.from} className="border-b border-border/70 last:border-0">
                        <td className="py-2.5">
                          {from} {detail.unit}
                        </td>
                        <td className={`py-2.5 text-right ${best ? "font-semibold text-stock" : ""}`}>
                          {eur(tier.price)}
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground">
                          {eur(tier.price * from)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

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
                      Keine Artikel für diese Auswahl.
                    </td>
                  </tr>
                )}
                {articles.map((article) => {
                  const q = getQty(article);
                  const unit = priceForQty(article, q);
                  const state = stockState(article.onHand);
                  const spec = specText(article.spec);
                  // Kleines Vorschaubild bevorzugen, damit die Liste leicht bleibt.
                  const thumb = data.thumbs?.[article.id] ?? imagesOf(article)[0];
                  return (
                    <Fragment key={article.sku}>
                    <tr className="border-t border-border/70">
                      <td className="px-3 pt-3 align-top">
                        <button
                          onClick={() => setDetailSku(article.sku)}
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
                          <span className="block font-semibold">{article.name}</span>
                        </span>
                      </td>

                      <td className="px-3 pt-3 align-top font-mono text-[13px] font-semibold">
                        {eur(unit)}
                      </td>
                      <td className="px-3 pt-3 align-top font-mono text-[12px] text-muted-foreground">
                        {article.unit}
                      </td>
                      <td className="px-3 pt-3 align-top font-mono text-[12px] text-muted-foreground">
                        {article.moq}
                      </td>
                      <td className="px-3 pt-3 align-top">
                        <span
                          className={`flex items-center gap-1.5 text-xs font-medium ${stockTone[state]}`}
                        >
                          <span className={`size-1.5 rounded-full ${stockDot[state]}`} />
                          {stockLabel[state]}
                          {article.onHand > 0 && (
                            <span className="font-mono text-muted-foreground">
                              {stockDisplay(article.onHand)}
                            </span>
                          )}

                        </span>
                      </td>
                      <td className="px-3 pt-3 align-top">
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
                      <td className="px-3 pt-3 align-top">
                        <button
                          onClick={() => addLine(article.sku, q)}
                          className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          Hinzufügen
                        </button>
                      </td>
                    </tr>
                    <tr>
                      <td />
                      <td colSpan={7} className="px-3 pb-3 pt-1">
                        <span className="line-clamp-2 block text-xs text-muted-foreground">
                          {spec || article.category}
                        </span>
                      </td>
                    </tr>
                    </Fragment>
                  );

                })}
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
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {line.qty} × {eur(line.unit)}
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
                    className="font-mono text-muted-foreground hover:text-foreground"
                  >
                    ×
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
              <button className="mt-2 w-full rounded-sm border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted">
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
