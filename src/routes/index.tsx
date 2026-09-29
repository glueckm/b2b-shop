import { BrandMarquee } from "@/components/BrandMarquee";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { ChevronDown, Heart, Percent, ShoppingCart, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import mawaLogo from "@/assets/mawa-logo-white.png";
import { articleImages } from "@/lib/article-images";
import { getArticleImageData, getArticleImageMap } from "@/lib/article-images.functions";
import {
  abandonBasket,
  checkoutBasket,
  copyBasket,
  createBasket,
  loadBaskets,
  removeBasketLine,
  renameBasket,
  setBasketLine,
  type Basket,
  type BasketState,
} from "@/lib/basket.functions";
import { getAccessories, getCatalog, SPEC_FIELDS, type CatalogArticle } from "@/lib/catalog.functions";
import {
  loadFavourites,
  markFavourite,
  unmarkFavourite,
  type FavouriteState,
} from "@/lib/favourites.functions";
import { shopLogout } from "@/lib/shop-auth.functions";
import { SHOP_VERSION } from "@/lib/version";


const searchSchema = z.object({
  channel: z.string().default("NET1"),
  category: z.string().default("Wärmebild & Nachtsicht"),
  subcategory: z.string().default(""),
  subsubcategory: z.string().default(""),
  q: z.string().default(""),
  artikel: z.string().default(""),
});

export const Route = createFileRoute("/")({
  // Der Katalog wird nur im Browser geladen. So führt der Wechsel von der
  // Anmeldung nicht gleichzeitig einen SSR- und einen Client-Lader aus.
  ssr: false,
  validateSearch: searchSchema,
  // Die Artikel-Detailseite (artikel) löst keinen neuen Katalogabruf aus.
  loaderDeps: ({ search: { artikel: _artikel, ...rest } }) => rest,
  // Gleiche Filter = keine erneute Abfrage (verhindert doppelten Katalogaufbau).
  staleTime: 120_000,
  loader: async ({ deps }) => {
    const catalog = await getCatalog({
      data: {
        channel: deps.channel,
        category: deps.category,
        subcategory: deps.subcategory,
        subsubcategory: deps.subsubcategory,
        search: deps.q,
      },
    });
    if (!catalog.user) {
      throw redirect({ to: "/anmelden" });
    }
    return catalog;
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

const imageDataCache = new Map<string, Promise<string | null>>();
const resolvedImageCache = new Map<string, string>();

function imageFileId(src: string) {
  const match = src.match(/\/artikel-bild\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1] ?? "") : "";
}

async function loadAuthenticatedImage(src: string): Promise<string | null> {
  if (src.startsWith("data:") || !src.includes("/api/public/artikel-bild/")) return src;
  const resolved = resolvedImageCache.get(src);
  if (resolved) return resolved;
  const existing = imageDataCache.get(src);
  if (existing) return existing;
  const fileId = imageFileId(src);
  if (!fileId) return null;
  const request = getArticleImageData({ data: { fileId } })
    .then((result) => {
      const dataUrl = result?.dataUrl ?? null;
      if (dataUrl) resolvedImageCache.set(src, dataUrl);
      else imageDataCache.delete(src);
      return dataUrl;
    })
    .catch(() => {
      imageDataCache.delete(src);
      return null;
    });
  imageDataCache.set(src, request);
  return request;
}

/** Großer Highlight-Bereich (weclapp „Highlight Produkt") mit automatischem Wechsel. */
function HighlightStage({
  items,
  thumbFor,
  requestImages,
  onAdd,
  onOpen,
}: {
  items: CatalogArticle[];
  thumbFor: (a: CatalogArticle) => string | undefined;
  requestImages: (id: string) => void;
  onAdd: (a: CatalogArticle) => void;
  onOpen: (a: CatalogArticle) => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const count = items.length;
  const current = items[Math.min(index, count - 1)];

  useEffect(() => {
    for (const a of items) requestImages(a.id);
  }, [items, requestImages]);

  useEffect(() => {
    if (paused || hover || count < 2) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), 6000);
    return () => clearTimeout(t);
  }, [index, paused, hover, count]);

  if (!current) return null;
  const price = priceForQty(current, current.moq);
  const list = current.breaks[0]?.price ?? price;
  const pct = current.rebatePct > 0 ? Math.round(current.rebatePct) : list > price ? Math.round((1 - price / list) * 100) : 0;
  const label = (a: CatalogArticle) => (a.promo ? `Aktion${pct && a === current ? ` −${pct} %` : ""}` : a.onHand > 0 ? "Auf Lager" : "Highlight");
  const tagline = specText(current.spec).split(/(?<=[.!?])\s/)[0]?.slice(0, 140) ?? "";
  const thumb = thumbFor(current);

  return (
    <section
      className="relative mb-6 overflow-hidden rounded-lg bg-primary text-primary-foreground"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label="Highlights"
    >
      {count > 1 && (
        <button
          onClick={() => setPaused((p) => !p)}
          className="absolute right-3 top-3 z-10 rounded-full bg-primary-foreground/10 px-3 py-1 text-xs font-medium hover:bg-primary-foreground/20"
        >
          {paused ? "▶ Weiter" : "❚❚ Pause"}
        </button>
      )}
      <div className="grid items-center gap-6 p-6 md:grid-cols-2 md:p-10">
        <div className="min-w-0">
          {current.promo && (
            <span className="inline-block rounded bg-destructive px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-destructive-foreground">
              Aktion{pct ? ` −${pct} %` : ""}
            </span>
          )}
          <p className="label-mono mt-4 text-primary-foreground/60">{current.manufacturer || current.category}</p>
          <button onClick={() => onOpen(current)} className="mt-2 block text-left text-3xl font-bold leading-tight hover:underline md:text-4xl">
            {current.name}
          </button>
          {tagline && <p className="mt-3 line-clamp-2 text-sm text-primary-foreground/75">{tagline}</p>}
          <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-3xl font-bold">{eur(price)}</span>
            <span className="text-xs text-primary-foreground/60">
              Ihr EK netto{current.uvp ? ` · UVP ${eur(current.uvp)}` : ""}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => onAdd(current)}
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90"
            >
              In den Warenkorb
            </button>
            <button
              onClick={() => onOpen(current)}
              className="rounded-md border border-primary-foreground/25 px-4 py-2.5 text-sm font-semibold hover:bg-primary-foreground/10"
            >
              Zum Produkt
            </button>
          </div>
        </div>
        <button
          onClick={() => onOpen(current)}
          className="grid aspect-[16/10] w-full place-items-center overflow-hidden rounded-lg bg-card"
        >
          {thumb ? (
            <ArticleImage key={thumb} src={thumb} alt={current.name} className="max-h-[85%] max-w-[85%] object-contain" />
          ) : (
            <span className="size-full animate-pulse bg-muted" />
          )}
        </button>
      </div>
      {count > 1 && (
        <div className="grid border-t border-primary-foreground/10" style={{ gridTemplateColumns: `repeat(${Math.min(count, 5)}, minmax(0, 1fr))` }}>
          {items.slice(0, 10).map((a, i) =>
            i >= 5 && count > 5 && i >= 5 ? null : (
              <button
                key={a.sku}
                onClick={() => setIndex(i)}
                className={`relative min-w-0 border-r border-primary-foreground/10 px-4 py-3 text-left last:border-r-0 hover:bg-primary-foreground/5 ${i === index ? "bg-primary-foreground/5" : ""}`}
              >
                {i === index && <span className="absolute left-0 top-0 h-0.5 w-6 bg-accent" />}
                <span className="block truncate text-sm font-semibold">{a.name}</span>
                <span className="block truncate text-xs text-primary-foreground/60">
                  {(a.manufacturer || a.category)} · {label(a)}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function ArticleImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const [resolved, setResolved] = useState<string | null>(() => resolvedImageCache.get(src) ?? null);

  useEffect(() => {
    let cancelled = false;
    const cached = resolvedImageCache.get(src);
    if (cached) {
      setResolved(cached);
      return () => {
        cancelled = true;
      };
    }
    // Ein fehlgeschlagener Abruf (z. B. kurzzeitige Backend-Last) wird erneut
    // versucht, damit kein dauerhaft leeres Feld stehen bleibt.
    const attempt = (tries: number) => {
      void loadAuthenticatedImage(src).then((value) => {
        if (cancelled) return;
        if (value) {
          setResolved(value);
          return;
        }
        if (tries > 0) setTimeout(() => attempt(tries - 1), 1200);
      });
    };
    attempt(3);
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved ? (
    <img src={resolved} alt={alt} className={className} loading="lazy" decoding="async" />
  ) : (
    <span aria-label={alt} className={`${className} bg-muted`} />
  );
}

/**
 * Meldet, sobald die Bildfläche in Sichtweite kommt — erst dann wird das
 * Vorschaubild des Artikels angefordert.
 */
function ThumbSlot({
  onVisible,
  children,
}: {
  onVisible: () => void;
  children: React.ReactNode;
}) {
  const holder = useRef<HTMLSpanElement | null>(null);
  const notify = useRef(onVisible);
  notify.current = onVisible;

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      notify.current();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          notify.current();
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={holder} className="block shrink-0">
      {children}
    </span>
  );
}

function Shop() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  // Läuft gerade ein Kategoriewechsel/Filterwechsel? Dann Ladeanzeige zeigen.
  const navPending = useRouterState({
    select: (state) => state.isLoading || state.isTransitioning,
  });

  const articles = data.articles;

  // Bilder werden nach dem Seitenaufbau portionsweise nachgeladen, damit die
  // Liste sofort erscheint.
  const [imageMap, setImageMap] = useState<Record<string, string[]>>({});
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const loadedIds = useRef(new Set<string>());
  const loadingIds = useRef(new Set<string>());
  const [imageLookupDone, setImageLookupDone] = useState<Set<string>>(() => new Set());

  // Bilder werden nur für sichtbare Zeilen geholt ("on demand" beim Scrollen).
  const queueRef = useRef(new Set<string>());
  const timerRef = useRef<number | null>(null);

  const loadBatch = useCallback(async (batch: string[], retry = true): Promise<void> => {
    try {
      const result = await getArticleImageMap({ data: { articleIds: batch } });
      if (!result.ok) {
        if (retry) {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          return loadBatch(batch, false);
        }
        batch.forEach((id) => loadingIds.current.delete(id));
        return;
      }
      batch.forEach((id) => {
        loadingIds.current.delete(id);
        loadedIds.current.add(id);
      });
      if (Object.keys(result.images).length > 0) {
        setImageMap((prev) => ({ ...prev, ...result.images }));
      }
      if (Object.keys(result.thumbs).length > 0) {
        setThumbMap((prev) => ({ ...prev, ...result.thumbs }));
      }
      setImageLookupDone((prev) => new Set([...prev, ...batch]));
    } catch {
      // Fehlgeschlagene Portionen bleiben erneut abrufbar.
      batch.forEach((id) => loadingIds.current.delete(id));
    }
  }, []);

  /** Bild eines Artikels anfordern; kurz gesammelt, dann als Sammelabfrage. */
  const requestImages = useCallback(
    (articleId: string) => {
      if (loadedIds.current.has(articleId) || loadingIds.current.has(articleId)) return;
      queueRef.current.add(articleId);
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const ids = [...queueRef.current];
        queueRef.current.clear();
        const pending = ids.filter(
          (id) => !loadedIds.current.has(id) && !loadingIds.current.has(id),
        );
        if (pending.length === 0) return;
        pending.forEach((id) => loadingIds.current.add(id));
        const CHUNK = 15;
        for (let index = 0; index < pending.length; index += CHUNK) {
          void loadBatch(pending.slice(index, index + CHUNK));
        }
      }, 120);
    },
    [loadBatch],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  /** Bilder aus dem MAWA-Backend, ergänzt um lokal abgelegte Dateien. */
  const imagesOf = (article: { id: string; sku: string }) => {
    const remote = imageMap[article.id] ?? [];
    return remote.length > 0 ? remote : articleImages(article.id, article.sku);
  };
  /** Lädt alle Artikelbilder als Dateien herunter. */
  const downloadPhotos = async (article: { id: string; sku: string }) => {
    const urls = imagesOf(article);
    for (let index = 0; index < urls.length; index += 1) {
      try {
        const resolved = await loadAuthenticatedImage(urls[index]!);
        if (!resolved) continue;
        const response = await fetch(resolved);
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
  const [localLines, setLocalLines] = useState<Line[]>([]);

  // Warenkörbe liegen im Backend; ohne Anmeldung bleibt der Korb lokal.
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [activeBasket, setActiveBasket] = useState<Basket | null>(null);
  const [basketBusy, setBasketBusy] = useState(false);
  const [basketNote, setBasketNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [orderDone, setOrderDone] = useState<string | null>(null);
  // Abweichungen zwischen gespeichertem und aktuellem Preis (Prüfung vor dem Absenden).
  const [priceDiffs, setPriceDiffs] = useState<
    { sku: string; qty: number; stored: number; current: number }[] | null
  >(null);


  // Favoriten des Kunden (Backend). Schlüssel ist die Artikel-ID.
  const [favourites, setFavourites] = useState<Set<string>>(new Set());

  const applyFavourites = (result: FavouriteState) => {
    if (result.ok) setFavourites(new Set(result.favourites.map((f) => f.articleId)));
  };

  useEffect(() => {
    if (!data.user) return;
    void loadFavourites().then(applyFavourites).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.user?.id]);

  const toggleFavourite = (article: { id: string }) => {
    const isFav = favourites.has(article.id);
    // Optimistisch umschalten, danach den Backend-Stand übernehmen.
    setFavourites((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(article.id);
      else next.add(article.id);
      return next;
    });
    const action = isFav ? unmarkFavourite : markFavourite;
    void action({ data: { articleId: article.id } })
      .then(applyFavourites)
      .catch(() => undefined);
  };

  const applyBasketState = (result: BasketState) => {
    if (result.ok) {
      setBaskets(result.baskets);
      setActiveBasket(result.active);
      setBasketNote(null);
      return true;
    }
    if (result.reason === "login") {
      setBaskets([]);
      setActiveBasket(null);
      setBasketNote("Zum Speichern von Warenkörben bitte anmelden.");
      return false;
    }
    // Bestehende Warenkörbe bleiben sichtbar, nur der Vorgang ist fehlgeschlagen.
    setBasketNote(
      result.message
        ? `Warenkorb-Vorgang fehlgeschlagen (${result.message}).`
        : "Warenkörbe sind derzeit nicht erreichbar.",
    );
    return false;
  };


  const runBasket = async (action: () => Promise<BasketState>) => {
    setBasketBusy(true);
    try {
      applyBasketState(await action());
    } catch {
      setBasketNote("Warenkörbe sind derzeit nicht erreichbar.");
    } finally {
      setBasketBusy(false);
    }
  };

  /**
   * Prüft, ob die im Warenkorb gespeicherten Preise noch den aktuellen
   * Katalogpreisen (Preisgruppe des Kunden) entsprechen.
   */
  const findPriceDiffs = async (basketId: string) => {
    const fresh = await loadBaskets({ data: { basketId } });
    if (!fresh.ok || !fresh.active) return [];
    return (fresh.active.lines ?? []).flatMap((line) => {
      // Nur Artikel der aktuellen Ansicht prüfen; für die übrigen liegt kein
      // aktueller Katalogpreis vor.
      const article = bySku.get(line.articleNumber);
      if (!article || line.priceShown === null) return [];
      const current = priceForQty(article, line.quantity);
      if (Math.abs(current - line.priceShown) < 0.005) return [];
      return [
        { sku: line.articleNumber, qty: line.quantity, stored: line.priceShown, current },
      ];
    });
  };

  /** Abweichende Positionen mit dem aktuellen Preis neu speichern. */
  const refreshPrices = async () => {
    if (!activeBasket || !priceDiffs) return;
    setBasketBusy(true);
    try {
      for (const diff of priceDiffs) {
        const article = articleForSku(diff.sku);
        if (!article) continue;
        await setBasketLine({
          data: {
            basketId: activeBasket.id,
            articleId: article.id,
            articleNumber: article.sku,
            quantity: diff.qty,
            name: article.name.slice(0, 400),
            priceShown: diff.current,
            salesChannel: data.pricing.channel,
          },
        }).then(applyBasketState);
      }
      setPriceDiffs(null);
    } catch {
      setBasketNote("Preise konnten nicht aktualisiert werden.");
    } finally {
      setBasketBusy(false);
    }
  };

  /** Warenkorb bestellen — wird im weclapp zum Auftrag. */
  const submitOrder = async () => {
    if (!activeBasket) return;
    setBasketBusy(true);
    setOrderDone(null);
    try {
      // Vor dem Absenden die Preise gegen den Katalog prüfen.
      const diffs = await findPriceDiffs(activeBasket.id);
      if (diffs.length > 0) {
        setPriceDiffs(diffs);
        setBasketBusy(false);
        return;
      }
      setPriceDiffs(null);

      const result = await checkoutBasket({

        data: {
          basketId: activeBasket.id,
          ...(orderRef.trim() ? { orderNumberAtCustomer: orderRef.trim() } : {}),
        },
      });
      if (result.ok) {
        applyBasketState(result.state);
        setOrderRef("");
        setOrderDone(
          result.orderNumber
            ? `Bestellung übermittelt · Auftragsnummer ${result.orderNumber}`
            : "Bestellung übermittelt.",
        );
      } else if (result.reason === "login") {
        setBasketNote("Zum Bestellen bitte anmelden.");
      } else {
        setBasketNote(
          result.message
            ? `Bestellung fehlgeschlagen (${result.message}).`
            : "Bestellung fehlgeschlagen.",
        );
      }
    } catch {
      setBasketNote("Bestellung fehlgeschlagen — das Backend ist nicht erreichbar.");
    } finally {
      setBasketBusy(false);
    }
  };

  useEffect(() => {
    if (!data.user) {
      setBasketNote("Zum Speichern von Warenkörben bitte anmelden.");
      return;
    }
    void runBasket(() => loadBaskets({ data: {} }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.user?.id]);
  const [term, setTerm] = useState(search.q);
  const detailSku = search.artikel || null;
  const [detailImage, setDetailImage] = useState(0);
  const [detailTab, setDetailTab] = useState("beschreibung");
  const [accessories, setAccessories] = useState<Record<string, CatalogArticle[]>>({});
  const [extraArticles, setExtraArticles] = useState<Map<string, CatalogArticle>>(new Map());
  useEffect(() => {
    if (!detailSku || accessories[detailSku]) return;
    const sku = detailSku;
    void getAccessories({ data: { sku } })
      .then((list) => {
        setAccessories((prev) => ({ ...prev, [sku]: list }));
        setExtraArticles((prev) => {
          const next = new Map(prev);
          list.forEach((a) => next.set(a.sku, a));
          return next;
        });
      })
      .catch(() => setAccessories((prev) => ({ ...prev, [sku]: [] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailSku]);
  useEffect(() => {
    setDetailImage(0);
    setDetailTab("beschreibung");
  }, [detailSku]);
  const setDetailSku = (sku: string | null) => {
    void navigate({ search: (prev) => ({ ...prev, artikel: sku ?? "" }) });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };
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

  /**
   * Ersatzartikel aus den im Warenkorb gespeicherten Daten: der Katalog zeigt
   * nur die aktuelle Kategorie/Suche, der Warenkorb aber alle Positionen.
   */
  const basketFallback = useMemo(() => {
    const out = new Map<string, CatalogArticle>();
    for (const line of activeBasket?.lines ?? []) {
      if (!line.articleNumber || bySku.has(line.articleNumber)) continue;
      out.set(line.articleNumber, {
        id: line.articleId,
        sku: line.articleNumber,
        name: line.name ?? line.articleNumber,
        spec: "",
        scope: "",
        category: "",
        level1: "",
        level2: "",
        level3: "",
        unit: "Stk.",
        moq: 1,
        onHand: 0,
        breaks: [{ from: 1, price: line.priceShown ?? 0 }],
        rebatePct: 0,
        groupId: "",
        groupSku: "",
        groupName: "",
        specs: {},
        promo: false,
        isPrimary: false,
        manufacturer: "",
        sold: 0,
        uvp: null,
        highlight: false,
      });
    }
    return out;
  }, [activeBasket, bySku]);

  /** Artikel für eine Warenkorbposition — Katalog zuerst, sonst Warenkorbdaten. */
  const articleForSku = (sku: string) =>
    bySku.get(sku) ??
    (data.highlights ?? []).find((h) => h.sku === sku) ??
    basketFallback.get(sku) ??
    extraArticles.get(sku);


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


  // Umschalter „Favoriten" in der Kategorieleiste.
  const [favOnly, setFavOnly] = useState(false);
  const [promoOnly, setPromoOnly] = useState(false);

  /** Zusatzfilter (Sensor, NETD, Objektiv …): ausgewählte Werte je Feld. */
  const [openFacets, setOpenFacets] = useState<string[]>([]);
  const [showSpecFilters, setShowSpecFilters] = useState(false);
  const [specFilters, setSpecFilters] = useState<Record<string, string[]>>({});

  /** Hersteller-Filter: nur die vier häufigsten Hersteller der aktuellen Auswahl. */
  const [makerFilter, setMakerFilter] = useState<string[]>([]);
  /** Klick auf ein Logo im Marken-Laufband: alle Artikel dieses Herstellers. */
  const [brandPick, setBrandPick] = useState<string | null>(null);
  const brandMatches = (maker: string) =>
    !brandPick || new RegExp(`(^|[^A-Z])${brandPick}`).test(maker.toUpperCase());
  const topMakers = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const a of articles) {
      const name = (a.manufacturer ?? "").trim().toUpperCase();
      if (!name) continue;
      if (!counts.has(name)) counts.set(name, new Set());
      counts.get(name)!.add(a.groupId || a.id);
    }
    const top = [...counts.entries()]
      .map(([name, set]) => ({ name, count: set.size }))
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name))
      .slice(0, 4);
    // Gewünschte Reihenfolge: NOCPIX immer vor PARD (Plätze tauschen).
    const n = top.findIndex((m) => m.name === "NOCPIX");
    const p = top.findIndex((m) => m.name === "PARD");
    if (n > p && p >= 0) [top[n], top[p]] = [top[p]!, top[n]!];
    return top;
  }, [articles]);
  useEffect(() => {
    setMakerFilter((prev) => {
      const kept = prev.filter((m) => topMakers.some((t) => t.name === m));
      return kept.length === prev.length ? prev : kept;
    });
  }, [topMakers]);

  /** Nur Felder anzeigen, die in der aktuellen Auswahl auch gepflegt sind. */
  const specFacets = useMemo(() => {
    const numeric = (value: string) => Number(value.replace(",", "."));
    // Gerätetyp und Bauform nicht als Tech. Filter anbieten.
    return SPEC_FIELDS.filter((field) => field.key !== "devicetype" && field.key !== "formfactor").map((field) => {
      const counts = new Map<string, number>();
      for (const article of articles) {
        const value = article.specs?.[field.key];
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const values = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => {
          const na = numeric(a.value);
          const nb = numeric(b.value);
          if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
          return a.value.localeCompare(b.value, "de");
        });
      return { ...field, values };
    }).filter((facet) => facet.values.length > 1);
  }, [articles]);

  // Auswahl verwerfen, sobald sie in der aktuellen Kategorie nicht mehr vorkommt.
  useEffect(() => {
    setSpecFilters((prev) => {
      const next: Record<string, string[]> = {};
      let changed = false;
      for (const [key, values] of Object.entries(prev)) {
        const facet = specFacets.find((f) => f.key === key);
        const kept = facet ? values.filter((v) => facet.values.some((o) => o.value === v)) : [];
        if (kept.length !== values.length) changed = true;
        if (kept.length > 0) next[key] = kept;
      }
      return changed ? next : prev;
    });
  }, [specFacets]);

  const toggleSpecValue = (key: string, value: string) =>
    setSpecFilters((prev) => {
      const current = prev[key] ?? [];
      const kept = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const next = { ...prev };
      if (kept.length > 0) next[key] = kept;
      else delete next[key];
      return next;
    });

  const activeSpecCount = useMemo(
    () => Object.values(specFilters).reduce((sum, values) => sum + values.length, 0),
    [specFilters],
  );

  /** Passt ein Artikel zu allen gesetzten Zusatzfiltern? */
  const matchesSpecs = useCallback(
    (article: CatalogArticle) =>
      Object.entries(specFilters).every(([key, values]) => {
        const value = article.specs?.[key];
        return value ? values.includes(value) : false;
      }),
    [specFilters],
  );

  // Keine Treffer im aktuellen Bereich: Suche automatisch unter allen Artikeln fortsetzen.
  const [searchFallback, setSearchFallback] = useState<{ from: string; q: string } | null>(null);
  useEffect(() => {
    if (navPending) return;
    const q = search.q.trim();
    if (q && search.category && data.total === 0) {
      setSearchFallback({
        from: [search.category, search.subcategory, search.subsubcategory].filter(Boolean).join(" › "),
        q,
      });
      void navigate({
        search: (prev) => ({ ...prev, category: "", subcategory: "", subsubcategory: "", artikel: "" }),
      });
      return;
    }
    if (searchFallback && (searchFallback.q !== q || search.category)) setSearchFallback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q, search.category, search.subcategory, search.subsubcategory, data.total, navPending]);

  // Suche nach exakter Artikelnummer einer Variante: direkt in den Variantenartikel springen.
  useEffect(() => {
    const q = search.q.trim().toLowerCase();
    if (!q || search.artikel) return;
    const hit = articles.find((a) => a.groupId && a.sku.toLowerCase() === q);
    if (hit) setDetailSku(hit.sku);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q, articles]);

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
    // Hauptartikel (weclapp primary_article) zuerst, danach nach Namen.
    for (const group of groups.values()) {
      group.variants.sort(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) ||
          a.name.localeCompare(b.name, "de", { numeric: true }),
      );
    }

    // Wärmebild & Nachtsicht: meistverkaufte Serien (ähnlicher Name) zuerst,
    // innerhalb der Serie das meistverkaufte Gerät zuerst. Bei Suche bleibt die Trefferreihenfolge.
    if (search.category === "Wärmebild & Nachtsicht" && !search.q.trim()) {
      const rowName = (r: Row) => (r.kind === "single" ? r.article.name : r.name);
      const rowSold = (r: Row) =>
        r.kind === "single" ? r.article.sold : r.variants.reduce((s, v) => s + v.sold, 0);
      const seriesOf = (name: string) =>
        name
          .replace(/\b(pard|nocpix|infiray|rusan|nitecore)\b/gi, " ")
          .replace(/^[\s-]+/, "")
          .split(/[\s-]+/)[0]
          ?.toLowerCase() ?? "";
      const seriesTotal = new Map<string, number>();
      for (const r of out) {
        const key = seriesOf(rowName(r));
        seriesTotal.set(key, (seriesTotal.get(key) ?? 0) + rowSold(r));
      }
      out.sort((x, y) => {
        const sx = seriesOf(rowName(x));
        const sy = seriesOf(rowName(y));
        return (
          (seriesTotal.get(sy) ?? 0) - (seriesTotal.get(sx) ?? 0) ||
          sx.localeCompare(sy) ||
          rowSold(y) - rowSold(x) ||
          rowName(x).localeCompare(rowName(y), "de", { numeric: true })
        );
      });
    }

    if (!favOnly && !promoOnly && activeSpecCount === 0 && makerFilter.length === 0 && !brandPick) return out;
    // Favoriten (Herz), Aktionen, Hersteller und Zusatzfilter anwenden; bei Varianten nur die passenden.
    const keep = (article: CatalogArticle) =>
      (!favOnly || favourites.has(article.id)) &&
      (!promoOnly || article.promo) &&
      (makerFilter.length === 0 || makerFilter.includes(article.manufacturer.toUpperCase())) &&
      brandMatches(article.manufacturer) &&
      matchesSpecs(article);
    return out.flatMap((row): Row[] => {
      if (row.kind === "single") return keep(row.article) ? [row] : [];
      const variants = row.variants.filter(keep);
      return variants.length > 0 ? [{ ...row, variants }] : [];
    });
  }, [articles, favOnly, promoOnly, favourites, activeSpecCount, matchesSpecs, makerFilter, brandPick, search.category, search.q]);


  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));



  /** Preisgruppe des angemeldeten Kunden (Anzeige), z. B. „PLATIN (NET6)". */
  const activeGroup = data.pricing.group
    ? `${data.pricing.group} (${data.pricing.channel})`
    : data.pricing.channel;



  const getQty = (article: CatalogArticle) => qty[article.sku] ?? article.moq;

  const step = (article: CatalogArticle, delta: number) =>
    setQty((prev) => ({
      ...prev,
      [article.sku]: Math.max(article.moq, getQty(article) + delta * article.moq),
    }));

  /** Positionen: aus dem Backend-Warenkorb, sonst lokal (nicht angemeldet). */
  const lines: Line[] = activeBasket
    ? (activeBasket.lines ?? []).map((line) => ({ sku: line.articleNumber, qty: line.quantity }))
    : localLines;

  /** Menge im Backend setzen (Upsert) — ohne Warenkorb nur lokal. */
  const saveLine = async (sku: string, quantity: number) => {
    const article = articleForSku(sku);
    if (!activeBasket || !article) return;
    await runBasket(() =>
      setBasketLine({
        data: {
          basketId: activeBasket.id,
          articleId: article.id,
          articleNumber: article.sku,
          quantity,
          name: article.name.slice(0, 400),
          priceShown: priceForQty(article, quantity),
          salesChannel: data.pricing.channel,
        },
      }),
    );
  };

  const addLine = (sku: string, amount: number) => {
    const current = lines.find((l) => l.sku === sku)?.qty ?? 0;
    if (activeBasket) {
      void saveLine(sku, current + amount);
      return;
    }
    setLocalLines((prev) => {
      const existing = prev.find((l) => l.sku === sku);
      if (existing) return prev.map((l) => (l.sku === sku ? { ...l, qty: l.qty + amount } : l));
      return [...prev, { sku, qty: amount }];
    });
  };

  const removeLine = (sku: string) => {
    const article = articleForSku(sku);
    if (activeBasket && article) {
      void runBasket(() =>
        removeBasketLine({ data: { basketId: activeBasket.id, articleId: article.id } }),
      );
      return;
    }
    setLocalLines((prev) => prev.filter((l) => l.sku !== sku));
  };

  /** Menge einer Warenkorbposition um eine Mindestbestellmenge erhöhen/verringern. */
  const stepLine = (sku: string, delta: number, moq: number) => {
    const unitStep = Math.max(1, moq);
    if (activeBasket) {
      const current = lines.find((l) => l.sku === sku)?.qty ?? 0;
      const next = current + delta * unitStep;
      if (next < unitStep) removeLine(sku);
      else void saveLine(sku, next);
      return;
    }
    setLocalLines((prev) =>
      prev.flatMap((l) => {
        if (l.sku !== sku) return [l];
        const next = l.qty + delta * unitStep;
        return next < unitStep ? [] : [{ ...l, qty: next }];
      }),
    );
  };


  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    void navigate({ search: (prev) => ({ ...prev, artikel: "", q: term.trim() }) });
  };


  const detailedLines = lines.flatMap((line) => {
    // Artikel außerhalb der aktuellen Ansicht (andere Kategorie/Suche) mit den
    // im Warenkorb gespeicherten Daten darstellen — sonst würden Positionen
    // aus Liste und Summe verschwinden, obwohl sie mitbestellt werden.
    const article = articleForSku(line.sku);
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

  /**
   * Artikelkachel. Bewusst als Funktion (kein eigener Komponententyp), damit
   * nachgeladene Bilder die Kacheln nicht neu aufbauen und flackern lassen.
   */
  const renderArticleCard = (article: CatalogArticle) => {
    const q = getQty(article);
    const unit = priceForQty(article, q);
    const listPrice = article.breaks[0]?.price ?? unit;
    const state = stockState(article.onHand);
    const spec = specText(article.spec);
    const thumb =
      thumbMap[article.id] ?? (imageLookupDone.has(article.id) ? imagesOf(article)[0] : undefined);
    const fav = favourites.has(article.id);
    const openDetail = () => {
      requestImages(article.id);
      setDetailSku(article.sku);
    };
    return (
      <div
        key={article.sku}
        className="group flex flex-col rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
      >
        <div className="relative">
          <ThumbSlot onVisible={() => requestImages(article.id)}>
            <button
              onClick={openDetail}
              className="grid h-28 w-full place-items-center overflow-hidden rounded-md bg-muted"
            >
              {thumb ? (
                <ArticleImage src={thumb} alt={article.name} className="max-h-24 max-w-[70%] object-contain" />
              ) : (
                <span className="label-mono text-muted-foreground">
                  {imageLookupDone.has(article.id) ? "Kein Bild" : "Produktbild"}
                </span>
              )}
            </button>
          </ThumbSlot>
          <button
            onClick={() => toggleFavourite(article)}
            aria-label={fav ? `Favorit entfernen ${article.sku}` : `Als Favorit merken ${article.sku}`}
            title={fav ? "Favorit entfernen" : "Als Favorit merken"}
            className={`absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-card/90 shadow-sm ${
              fav ? "text-accent" : "text-muted-foreground hover:text-accent"
            }`}
          >
            <Heart className="size-4" {...(fav ? { fill: "currentColor" } : {})} />
          </button>
          {article.promo && (
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-sm bg-destructive px-2 py-0.5 text-[11px] font-bold uppercase text-destructive-foreground">
              <Percent className="size-3" /> Aktion
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="label-mono truncate text-muted-foreground">{article.level1}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{article.sku}</span>
        </div>
        <button onClick={openDetail} className="mt-1 text-left">
          <span className="line-clamp-2 text-[15px] font-bold leading-snug">{article.name}</span>
        </button>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {spec || article.category}
        </p>

        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <p className="text-[12px] text-muted-foreground">Ihr EK netto / {article.unit}</p>
            <p className="font-mono text-xl font-bold tracking-tight">{eur(unit)}</p>
          </div>
          <div className="text-right text-[12px]">
            {listPrice > unit && (
              <p className="text-muted-foreground line-through">{eur(listPrice)}</p>
            )}
            {article.moq > 1 && <p className="text-muted-foreground">Mind. {article.moq}</p>}
            {article.breaks.length > 1 && (
              <p className="font-semibold text-stock">Staffelpreise</p>
            )}
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-4">
          <span className={`flex min-w-0 items-center gap-1.5 text-sm font-medium ${stockTone[state]}`}>
            <span className={`size-2 shrink-0 rounded-full ${stockDot[state]}`} />
            <span className="truncate">
              {article.onHand > 0
                ? `${stockLabel[state]} · ${stockDisplay(article.onHand)}`
                : "Bestellbar"}
            </span>
          </span>
          <span className="flex items-center justify-end gap-1.5">
            <span className="flex items-center rounded-sm border border-border">
              <button
                onClick={() => step(article, -1)}
                aria-label={`Menge verringern ${article.sku}`}
                className="grid size-8 place-items-center font-mono text-muted-foreground hover:text-foreground"
              >
                −
              </button>
              <span className="w-8 text-center font-mono text-[13px]">{q}</span>
              <button
                onClick={() => step(article, 1)}
                aria-label={`Menge erhöhen ${article.sku}`}
                className="grid size-8 place-items-center font-mono text-muted-foreground hover:text-foreground"
              >
                +
              </button>
            </span>
            <button
              onClick={() => addLine(article.sku, q)}
              className="rounded-sm bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {article.onHand > 0 ? "In den Korb" : "Vormerken"}
            </button>
          </span>
        </div>
      </div>
    );
  };

  /** Variantenartikel (Mutter) als eine Kachel; Varianten klappen darunter auf. */
  const renderGroupCard = (row: {
    id: string;
    sku: string;
    name: string;
    variants: CatalogArticle[];
  }) => {
    const q = search.q.trim().toLowerCase();
    const first =
      (q &&
        (row.variants.find((v) => v.sku.toLowerCase() === q) ??
          row.variants.find((v) => v.sku.toLowerCase().includes(q) || v.name.toLowerCase().includes(q)))) ||
      row.variants[0];
    const thumbArticle = row.variants.find((v) => thumbMap[v.id]) ?? first;
    const thumb = thumbArticle ? thumbMap[thumbArticle.id] : undefined;
    const open = !!openGroups[row.id];
    return (
      <div
        key={`gc-${row.id}`}
        className={`flex flex-col rounded-lg border bg-card p-3 shadow-sm ${open ? "border-accent" : "border-border"}`}
      >
        <ThumbSlot onVisible={() => row.variants.slice(0, 3).forEach((v) => requestImages(v.id))}>
          <button
            onClick={() => first && setDetailSku(first.sku)}
            className="grid h-28 w-full place-items-center overflow-hidden rounded-md bg-muted"
          >
            {thumb ? (
              <ArticleImage src={thumb} alt={row.name} className="max-h-24 max-w-[70%] object-contain" />
            ) : (
              <span className="label-mono text-muted-foreground">Produktbild</span>
            )}
          </button>
        </ThumbSlot>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="label-mono truncate text-muted-foreground">{first?.level1}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{row.sku}</span>
        </div>
        <button onClick={() => first && setDetailSku(first.sku)} className="mt-1 text-left">
          <span className="line-clamp-2 text-[15px] font-bold leading-snug">{row.name}</span>
        </button>
        <p className="label-mono mt-1 text-muted-foreground">{row.variants.length} Varianten</p>
        <div className="mt-3">
          <p className="text-[12px] text-muted-foreground">Ihr EK netto</p>
          <p className="font-mono text-xl font-bold tracking-tight">
            ab {eur(Math.min(...row.variants.map((v) => priceForQty(v, v.moq))))}
          </p>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="flex items-center gap-1.5 text-xs font-medium text-stock">
            <span className="size-2 rounded-full bg-stock" />
            {row.variants.filter((v) => v.onHand > 0).length} von {row.variants.length} lagernd
          </span>
          <button
            onClick={() => first && setDetailSku(first.sku)}
            className="rounded-sm border border-primary px-3 py-2 text-sm font-bold transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Varianten ansehen
          </button>
        </div>
      </div>
    );
  };

  /** Bildergalerie der Detailseite: großes Bild, Pfeile, Vorschaubilder. */
  const renderGallery = (article: CatalogArticle) =>
    imagesOf(article).length === 0 ? (
      <div className="grid h-[420px] place-items-center rounded-md border border-border bg-muted label-mono text-muted-foreground">Kein Bild</div>
    ) : (
      <>
              {(() => {
                const imgs = imagesOf(article);
                const current = Math.min(detailImage, imgs.length - 1);
                const go = (delta: number) =>
                  setDetailImage((current + delta + imgs.length) % imgs.length);
                return (
                  <div className="">
                    <div className="relative grid h-[420px] place-items-center rounded-md border border-border bg-muted">
                      <ArticleImage
                        src={imgs[current] ?? ""}
                        alt={`${article.name} — Bild ${current + 1}`}
                        className="max-h-[400px] max-w-full object-contain"
                      />
                      {imgs.length > 1 && (
                        <>
                          <button
                            onClick={() => go(-1)}
                            aria-label="Vorheriges Bild"
                            className="absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-2xl shadow hover:text-accent"
                          >
                            ‹
                          </button>
                          <button
                            onClick={() => go(1)}
                            aria-label="Nächstes Bild"
                            className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-2xl shadow hover:text-accent"
                          >
                            ›
                          </button>
                          <span className="absolute bottom-2 right-3 font-mono text-[11px] text-muted-foreground">
                            {current + 1} / {imgs.length}
                          </span>
                        </>
                      )}
                    </div>
                    {imgs.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {imgs.map((src, index) => (
                          <button
                            key={src}
                            onClick={() => setDetailImage(index)}
                            aria-label={`Bild ${index + 1} anzeigen`}
                            className={`rounded-sm border bg-panel p-0.5 transition-colors hover:border-accent ${
                              index === current ? "border-accent" : "border-border"
                            }`}
                          >
                            <ArticleImage
                              src={src}
                              alt={`${article.name} — Bild ${index + 1}`}
                              className="h-16 w-16 object-contain"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
      </>
    );

  /** Detailinhalt (Bilder, Beschreibung, Staffeln) für das Artikel-Pop-up. */
  const renderDetail = (article: CatalogArticle) => (
    <div>
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
    </div>
  );

  const detailArticle = detailSku ? articleForSku(detailSku) : undefined;



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
            <ArticleImage
              src={lightbox.images[lightbox.index] ?? lightbox.images[0] ?? ""}
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
                  <ArticleImage src={src} alt="" className="h-14 w-14 object-contain" />
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
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-5 py-3">
          <img
            src={mawaLogo}
            alt="MAWA Trading"
            width={369}
            height={77}
            className="h-7 w-auto shrink-0"
          />
          <form onSubmit={submitSearch} className="hidden min-w-0 flex-1 md:block">
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Suche nach Artikel, Marke oder Art.-Nr. …"
              aria-label="Katalog durchsuchen"
              className="w-full rounded-sm border border-primary-foreground/10 bg-primary-foreground/10 px-4 py-2.5 text-sm text-primary-foreground outline-none placeholder:text-primary-foreground/50 focus:border-accent"
            />
          </form>
          <div className="ml-auto flex shrink-0 items-center gap-5 text-sm">
            {data.user ? (
              <Link to="/konto" className="font-medium hover:text-accent">
                {data.user.displayName ?? "Mein Konto"}
                {data.user.customerNumber && (
                  <span className="opacity-70"> · Kd. {data.user.customerNumber}</span>
                )}
              </Link>
            ) : (
              <Link to="/anmelden" className="font-semibold hover:text-accent">
                Anmelden
              </Link>
            )}
            {data.user && (
              <Link to="/bestellungen" className="hidden font-medium hover:text-accent lg:inline">
                Bestellungen
              </Link>
            )}
            <button
              onClick={() => setFavOnly((prev) => !prev)}
              aria-pressed={favOnly}
              title="Alle Artikel, die Sie mit dem Herz markiert haben."
              className={`flex items-center gap-1.5 font-medium hover:text-accent ${favOnly ? "text-accent" : ""}`}
            >
              <Heart className="size-4" {...(favOnly ? { fill: "currentColor" } : {})} />
              Merkliste
              {favourites.size > 0 && (
                <span className="font-mono text-xs opacity-80">{favourites.size}</span>
              )}
            </button>
            <a
              href="#order"
              className="flex items-center gap-2 rounded-sm bg-accent px-4 py-2 font-semibold text-accent-foreground"
            >
              <ShoppingCart className="size-4" />
              Warenkorb · {lines.length}
            </a>
            {data.user && (
              <button
                onClick={async () => {
                  await shopLogout({});
                  await router.invalidate();
                }}
                className="text-primary-foreground/60 hover:text-accent"
              >
                Abmelden
              </button>
            )}
          </div>
        </div>
        <form onSubmit={submitSearch} className="px-5 pb-3 md:hidden">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Suche nach Artikel, Marke oder Art.-Nr. …"
            aria-label="Katalog durchsuchen"
            className="w-full rounded-sm bg-primary-foreground/10 px-4 py-2.5 text-sm text-primary-foreground outline-none placeholder:text-primary-foreground/50"
          />
        </form>
      </header>

      {(() => {
        // Feste Reihenfolge: Wärmebild & Nachtsicht, Jagdbedarf, Adapter, Montagen, Rest, danach "Alle Artikel".
        const order = ["wärmebild & nachtsicht", "jagdbedarf", "adapter für vorsatzgeräte", "montagen"];
        const rank = (name: string) => {
          const idx = order.indexOf(name.trim().toLowerCase());
          return idx === -1 ? order.length : idx;
        };
        const navCats = [
          ...[...data.categories].sort(
            (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
          ),
          { name: "", count: data.stats.articles },
        ];
        const shortLabel = (name: string) => {
          const n = name.trim().toLowerCase();
          if (!name) return "Alle Artikel";
          if (n === "adapter für vorsatzgeräte") return "Adapter";
          if (n === "mündung & schalldämpfer") return "Schalldämpfer";
          return name;
        };
        const selectCategory = (name: string) => {
          setBrandPick(null);
          setPromoOnly(false);
          setTerm("");
          void navigate({
            search: (prev) => ({
              ...prev, artikel: "",
              category: name,
              subcategory: "",
              subsubcategory: "",
              q: "",
            }),
          });
        };
        const togglePromo = () => {
          setBrandPick(null);
          setPromoOnly((prev) => !prev);
          setTerm("");
          void navigate({
            search: (prev) => ({
              ...prev, artikel: "",
              category: "",
              subcategory: "",
              subsubcategory: "",
              q: "",
            }),
          });
        };
        return (
          <nav className="sticky top-0 z-40 border-t border-primary-foreground/10 bg-primary text-primary-foreground shadow-md">
            {/* PC / Tablet: kompakte Einzeiler-Leiste */}
            <div className="mx-auto hidden max-w-[1600px] items-center gap-0.5 px-4 md:flex">
              {navCats.map((category) => {
                const active = !promoOnly && category.name === search.category;
                return (
                  <button
                    key={category.name || "all"}
                    onClick={() => selectCategory(active ? "" : category.name)}
                    title={category.name || "Alle Artikel"}
                    className={`whitespace-nowrap border-b-2 px-2.5 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] transition-colors lg:text-[13px] ${
                      active
                        ? "border-accent text-primary-foreground"
                        : "border-transparent text-primary-foreground/75 hover:text-primary-foreground"
                    }`}
                  >
                    {shortLabel(category.name)}
                  </button>
                );
              })}
              <button
                onClick={togglePromo}
                aria-pressed={promoOnly}
                title="Alle Artikel, die in weclapp als Aktion gekennzeichnet sind."
                className={`ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-xs font-bold uppercase tracking-[0.04em] text-accent transition-colors lg:text-[13px] ${
                  promoOnly ? "border-accent" : "border-transparent hover:opacity-80"
                }`}
              >
                <Percent className="size-4" />
                Aktionen
              </button>
            </div>

            {/* Handy: kompaktes Auswahl-Dropdown */}
            <div className="flex items-center gap-2 px-4 py-2 md:hidden">
              <select
                aria-label="Kategorie wählen"
                value={promoOnly ? "__promo" : search.category}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__promo") {
                    if (!promoOnly) togglePromo();
                  } else selectCategory(v);
                }}
                className="min-w-0 flex-1 rounded-md border border-primary-foreground/20 bg-primary px-3 py-2 text-sm font-semibold uppercase tracking-[0.04em] text-primary-foreground"
              >
                {navCats.map((category) => (
                  <option key={category.name || "all"} value={category.name}>
                    {category.name || "Alle Artikel"}
                  </option>
                ))}
                <option value="__promo">Aktionen</option>
              </select>
              <button
                onClick={togglePromo}
                aria-pressed={promoOnly}
                className={`flex shrink-0 items-center gap-1 rounded-md border px-3 py-2 text-xs font-bold uppercase text-accent ${
                  promoOnly ? "border-accent" : "border-primary-foreground/20"
                }`}
              >
                <Percent className="size-4" />
                Aktionen
              </button>
            </div>
          </nav>
        );
      })()}


      <div className="mx-auto grid max-w-[1600px] gap-6 px-5 py-7 lg:grid-cols-[220px_minmax(0,1fr)_330px]">
        <aside className="space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          {(() => {
            const block = (
              title: string,
              items: { name: string; count?: number }[],
              current: string,
              pick: (name: string) => void,
            ) =>
              items.length > 0 && (
                <div>
                  <h3 className="text-[13px] font-bold uppercase tracking-[0.08em]">{title}</h3>
                  <ul className="mt-2 space-y-0.5">
                    {items.map((item) => {
                      const active = item.name === current;
                      return (
                        <li key={item.name}>
                          <button
                            onClick={() => pick(active ? "" : item.name)}
                            className={`flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm transition-colors hover:bg-muted ${
                              active ? "font-semibold text-accent" : "text-foreground/85"
                            }`}
                          >
                            <span className="min-w-0 truncate">{item.name}</span>
                            {item.count !== undefined && (
                              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                                {item.count}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            return (
              <>
                {block(search.category || "Kategorie", subCategories, search.subcategory, (name) => {
                  setTerm("");
                  void navigate({
                    search: (prev) => ({ ...prev, artikel: "", subcategory: name, subsubcategory: "", q: "" }),
                  });
                })}
                {block(search.subcategory, subSubCategories, search.subsubcategory, (name) => {
                  setTerm("");
                  void navigate({
                    search: (prev) => ({ ...prev, artikel: "", subsubcategory: name, q: "" }),
                  });
                })}
              </>
            );
          })()}

          {topMakers.length > 1 && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.08em]">Hersteller</h3>
                {makerFilter.length > 0 && (
                  <button
                    onClick={() => setMakerFilter([])}
                    className="text-[12px] font-semibold text-accent hover:underline"
                  >
                    zurücksetzen
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {topMakers.map((m) => {
                  const active = makerFilter.includes(m.name);
                  return (
                    <label
                      key={m.name}
                      className={`flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-[13px] transition-colors hover:bg-muted ${
                        active ? "font-semibold text-accent" : "text-muted-foreground"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() =>
                          setMakerFilter((prev) =>
                            prev.includes(m.name) ? prev.filter((x) => x !== m.name) : [...prev, m.name],
                          )
                        }
                        className="size-3.5 shrink-0 accent-accent"
                      />
                      <span className="min-w-0 truncate uppercase">{m.name}</span>
                      <span className="ml-auto font-mono text-[11px] opacity-60">{m.count}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {specFacets.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <Switch
                    checked={showSpecFilters}
                    onCheckedChange={(on) => {
                      setShowSpecFilters(on);
                      if (!on) setSpecFilters({});
                    }}
                    aria-label="Technische Filter ein/aus"
                  />
                  <h3 className="text-[13px] font-bold uppercase tracking-[0.08em]">Tech. Filter</h3>
                </label>
                {showSpecFilters && activeSpecCount > 0 && (
                  <button
                    onClick={() => setSpecFilters({})}
                    className="text-[12px] font-semibold text-accent hover:underline"
                  >
                    zurücksetzen
                  </button>
                )}
              </div>

              <div className={`mt-2 divide-y divide-border ${showSpecFilters ? "" : "hidden"}`}>
                {specFacets.map((facet) => {
                  const selected = specFilters[facet.key] ?? [];
                  const open = openFacets.includes(facet.key) || selected.length > 0;
                  return (
                    <div key={facet.key} className="py-2">
                      <button
                        onClick={() =>
                          setOpenFacets((prev) =>
                            prev.includes(facet.key)
                              ? prev.filter((k) => k !== facet.key)
                              : [...prev, facet.key],
                          )
                        }
                        aria-expanded={open}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <ChevronDown
                          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                            open ? "" : "-rotate-90"
                          }`}
                        />
                        <span
                          className={`label-mono ${
                            selected.length > 0 ? "text-accent" : "text-muted-foreground"
                          }`}
                        >
                          {facet.label}
                        </span>
                        {selected.length > 0 && (
                          <span className="ml-auto font-mono text-[11px] text-accent">
                            {selected.length}
                          </span>
                        )}
                      </button>
                      {open && (
                        <div className="mt-1.5 flex flex-col gap-1 pl-5">
                          {facet.values.map((option) => {
                            const active = selected.includes(option.value);
                            return (
                              <label
                                key={option.value}
                                className={`flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-[13px] transition-colors hover:bg-muted ${
                                  active ? "font-semibold text-accent" : "text-muted-foreground"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={active}
                                  onChange={() => toggleSpecValue(facet.key, option.value)}
                                  className="size-3.5 shrink-0 accent-accent"
                                />
                                <span className="min-w-0 truncate">{option.value}</span>
                                <span className="ml-auto font-mono text-[11px] opacity-60">
                                  {option.count}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <main className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p id="catalog" className="flex items-center gap-2 text-sm text-muted-foreground">
              <button
                onClick={() => {
                  setTerm("");
                  void navigate({
                    search: (prev) => ({
                      ...prev, artikel: "",
                      category: "",
                      subcategory: "",
                      subsubcategory: "",
                      q: "",
                    }),
                  });
                }}
                className="hover:text-foreground"
              >
                Alle Artikel
              </button>
              {[search.category, search.subcategory, search.subsubcategory]
                .filter(Boolean)
                .map((crumb) => (
                  <span key={crumb}>
                    ›{" "}
                    {detailArticle ? (
                      <button onClick={() => setDetailSku(null)} className="hover:text-foreground">
                        {crumb}
                      </button>
                    ) : (
                      crumb
                    )}
                  </span>
                ))}
              {search.q && <span>› „{search.q}“</span>}
              {detailArticle ? (
                <span className="font-semibold text-foreground">› {detailArticle.name}</span>
              ) : (
              <span>
                ·{" "}
                {navPending ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                    wird geladen …
                  </span>
                ) : (
                  <>{num(data.total)} Artikel</>
                )}
              </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">Preise netto ohne USt.</p>
          </div>

          {detailArticle ? (
            <div className="mt-4 rounded-lg border border-border bg-card p-6 shadow-sm">
              <button
                onClick={() => setDetailSku(null)}
                className="text-sm font-semibold text-muted-foreground hover:text-accent"
              >
                ← Zurück zur Übersicht
              </button>
              {(() => {
                const a = detailArticle;
                const q = getQty(a);
                const unit = priceForQty(a, q);
                const state = stockState(a.onHand);
                const fav = favourites.has(a.id);
                const activeFrom = [...a.breaks]
                  .filter((t) => Math.max(t.from, a.moq) <= q)
                  .pop()?.from;
                // Nur die wichtigsten Merkmale als Chips; alles Weitere steht unter „Technische Daten".
                const chipKeys = ["sensor", "netd", "lens", "nv_sensor", "nv_lens", "lrf", "cell"];
                const chips = SPEC_FIELDS.filter(
                  (f) => chipKeys.includes(f.key) && a.specs[f.key] && Number(a.specs[f.key]!.replace(",", ".")) !== 0,
                ).map((f) => ({
                  label: f.label.replace(/\s*\(.*\)/, ""),
                  value: a.specs[f.key],
                }));
                return (
                  <div className="mt-4 grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                    <div>
                      {renderGallery(a)}
                    </div>
                      {(() => {
                        if (!a.groupId) return null;
                        const siblings = articles
                          .filter((v) => v.groupId === a.groupId)
                          .sort(
                            (x, y) =>
                              Number(y.isPrimary) - Number(x.isPrimary) ||
                              x.name.localeCompare(y.name, "de", { numeric: true }),
                          );
                        if (siblings.length < 2) return null;
                        return (
                          <div className="-mt-4 xl:order-3 xl:col-span-2">
                            <p className="label-mono text-muted-foreground">
                              {siblings.length} Varianten
                            </p>
                            <div className="mt-2 max-h-[16.5rem] overflow-y-auto rounded-md border border-border">
                              {siblings.map((v) => {
                                const current = v.sku === a.sku;
                                const vs = stockState(v.onHand);
                                return (
                                  <button
                                    key={v.sku}
                                    onClick={() => setDetailSku(v.sku)}
                                    aria-current={current}
                                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-0 ${
                                      current ? "bg-accent/15" : "hover:bg-muted"
                                    }`}
                                  >
                                    <span className="min-w-0">
                                      <span className={`block truncate ${current ? "font-semibold" : ""}`}>{v.name}</span>
                                      <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                                        {v.sku}
                                        <span className={`inline-flex items-center gap-1 ${stockTone[vs]}`}>
                                          <span className={`size-1.5 rounded-full ${stockDot[vs]}`} />
                                          {v.onHand > 0 ? stockDisplay(v.onHand) : "nicht lagernd"}
                                        </span>
                                      </span>
                                    </span>
                                    <span className="shrink-0 font-mono font-semibold">{eur(priceForQty(v, v.moq))}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    <div>
                      <p className="label-mono text-muted-foreground">
                        {[a.level1, a.level2].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                        <h1 className="text-3xl font-bold leading-tight tracking-tight">{a.name}</h1>
                        {a.uvp != null && (
                          <p className="text-right">
                            <span className="label-mono text-muted-foreground">UVP </span>
                            <span className="text-xl font-semibold">{eur(a.uvp)}</span>
                            <span className="ml-1 text-xs text-muted-foreground">inkl. USt.</span>
                          </p>
                        )}
                      </div>
                      <p className="mt-2 font-mono text-[13px] text-muted-foreground">
                        Art.-Nr.{" "}
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-foreground">{a.sku}</span>
                        {a.groupSku && a.groupSku !== a.sku && <> · Variante von {a.groupSku}</>}
                      </p>
                      {chips.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {chips.map((c) => (
                            <span key={c.label} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px]">
                              {c.label} <b>{c.value}</b>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-5 rounded-lg border border-border bg-background p-5">
                        <p className="text-[13px] text-muted-foreground">Ihr Einkaufspreis netto</p>
                        <p className="mt-1">
                          <span className="font-mono text-4xl font-bold tracking-tight">{eur(unit)}</span>{" "}
                          <span className="text-sm text-muted-foreground">zzgl. USt. / {a.unit}</span>
                        </p>
                        {a.rebatePct > 0 && (
                          <p className="mt-2 text-[12px] text-stock">
                            inkl. {a.rebatePct} % Konditionsrabatt Ihrer Preisgruppe
                          </p>
                        )}
                        {a.breaks.length > 1 && (
                          <div className="mt-4 overflow-hidden rounded-md border border-border">
                            {a.breaks.map((t) => {
                              const from = Math.max(t.from, a.moq);
                              const active = t.from === activeFrom;
                              return (
                                <button
                                  key={t.from}
                                  onClick={() => setQty((prev) => ({ ...prev, [a.sku]: from }))}
                                  className={`flex w-full justify-between border-b border-border px-3 py-2 text-sm last:border-0 ${
                                    active ? "bg-accent/15 font-semibold" : "hover:bg-muted"
                                  }`}
                                >
                                  <span>ab {from} {a.unit}</span>
                                  <span className="font-mono">{eur(t.price)}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <p className={`mt-4 flex items-center gap-2 text-sm font-medium ${stockTone[state]}`}>
                          <span className={`size-2.5 rounded-full ${stockDot[state]}`} />
                          {a.onHand > 0
                            ? `${stockLabel[state]} · ${stockDisplay(a.onHand)}`
                            : "Derzeit nicht lagernd – bestellbar"}
                        </p>
                        {a.moq > 1 && (
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            Mindestmenge {a.moq} {a.unit}
                          </p>
                        )}
                        <div className="mt-4 flex gap-3">
                          <span className="flex items-center rounded-md border border-border">
                            <button onClick={() => step(a, -1)} aria-label="Menge verringern" className="grid size-11 place-items-center text-lg">−</button>
                            <span className="w-10 text-center font-mono">{q}</span>
                            <button onClick={() => step(a, 1)} aria-label="Menge erhöhen" className="grid size-11 place-items-center text-lg">+</button>
                          </span>
                          <button
                            onClick={() => addLine(a.sku, q)}
                            className="flex-1 rounded-md bg-accent px-4 text-base font-bold text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                          >
                            {a.onHand > 0 ? "In den Warenkorb" : "Vormerken"}
                          </button>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-accent">
                          <button onClick={() => toggleFavourite(a)} className="flex items-center gap-1 hover:underline">
                            <Heart className="size-4" {...(fav ? { fill: "currentColor" } : {})} />
                            {fav ? "Von der Merkliste entfernen" : "Auf die Merkliste"}
                          </button>
                          <button onClick={() => setScopeArticle(a)} disabled={!a.scope} className="hover:underline disabled:opacity-40">
                            Lieferumfang
                          </button>
                          <button onClick={() => void downloadPhotos(a)} disabled={imagesOf(a).length === 0} className="hover:underline disabled:opacity-40">
                            Foto-Download
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="xl:order-4 xl:col-span-2">
                      <div className="flex flex-wrap gap-1 border-b border-border">
                        {[
                          ["beschreibung", "Beschreibung"],
                          ["technik", "Technische Daten"],
                          ["lieferumfang", "Lieferumfang"],
                          ["downloads", "Downloads & Marketing"],
                          ["garantie", "Garantie & Service"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => setDetailTab(key!)}
                            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                              detailTab === key
                                ? "border-accent text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="max-w-3xl py-5 text-[14px] leading-relaxed">
                        {detailTab === "beschreibung" && (
                          <p className="text-muted-foreground">Für diesen Artikel ist noch keine Beschreibung hinterlegt.</p>
                        )}
                        {detailTab === "technik" && (() => {
                          // Einheitliche Tabelle für alle Wärmebild-/Nachtsichtgeräte; 0-Werte ausblenden.
                          const groups: { title: string; keys: string[] }[] = [
                            { title: "Allgemein", keys: ["devicetype", "formfactor", "display", "lrf", "cell", "battery", "storage"] },
                            { title: "Wärmebild", keys: ["sensor", "netd", "lens", "magnification", "zoom", "detection", "framerate", "fov"] },
                            { title: "Nachtsicht", keys: ["nv_sensor", "nv_lens", "nv_magnification", "nv_zoom", "nv_detection", "nv_framerate", "nv_fov"] },
                          ];
                          const shown = (v?: string) => {
                            const t = (v ?? "").trim();
                            return t !== "" && Number(t.replace(",", ".")) !== 0 ? t : "";
                          };
                          const label = (k: string) => SPEC_FIELDS.find((f) => f.key === k)?.label ?? k;
                          const filled = groups
                            .map((g) => ({ ...g, rows: g.keys.filter((k) => shown(a.specs?.[k])) }))
                            .filter((g) => g.rows.length > 0);
                          if (!a.spec && filled.length === 0)
                            return <p className="text-muted-foreground">Keine technischen Daten hinterlegt.</p>;
                          return (
                            <div className="space-y-5">
                              {a.spec && (
                                <div className="spec-html" dangerouslySetInnerHTML={{ __html: sanitizeSpec(a.spec) }} />
                              )}
                              {filled.length > 0 && (
                                <table className="w-full border-collapse overflow-hidden rounded-sm border border-border text-[13px]">
                                  <tbody>
                                    {filled.map((g) => (
                                      <Fragment key={g.title}>
                                        <tr className="bg-muted">
                                          <th colSpan={2} className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[0.08em]">
                                            {g.title}
                                          </th>
                                        </tr>
                                        {g.rows.map((k) => (
                                          <tr key={k} className="border-t border-border">
                                            <td className="w-1/2 px-3 py-1.5 text-muted-foreground">
                                              {label(k).replace(/^NV-|^NV /, "")}
                                            </td>
                                            <td className="px-3 py-1.5 font-medium">{shown(a.specs[k])}</td>
                                          </tr>
                                        ))}
                                      </Fragment>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          );
                        })()}
                        {detailTab === "lieferumfang" &&
                          (a.scope ? (
                            <div className="spec-html" dangerouslySetInnerHTML={{ __html: sanitizeSpec(a.scope) }} />
                          ) : (
                            <p className="text-muted-foreground">Kein Lieferumfang hinterlegt.</p>
                          ))}
                        {detailTab === "downloads" && (
                          <div className="space-y-3">
                            <button
                              onClick={() => void downloadPhotos(a)}
                              disabled={imagesOf(a).length === 0}
                              className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                            >
                              Produktfotos herunterladen ({imagesOf(a).length})
                            </button>
                            <p className="text-muted-foreground">Datenblätter und Marketingmaterial folgen.</p>
                          </div>
                        )}
                        {detailTab === "garantie" && (
                          <p className="text-muted-foreground">Informationen zu Garantie und Service folgen.</p>
                        )}
                      </div>
                    </div>
                    {(accessories[a.sku]?.length ?? 0) > 0 && (
                      <div className="xl:order-4 xl:col-span-2">
                        <h2 className="text-xl font-bold tracking-tight">Passendes Zubehör</h2>
                        <p className="text-[13px] text-muted-foreground">Kunden, die diesen Artikel gekauft haben, kauften auch</p>
                        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
                          {accessories[a.sku]!.map((acc) => {
                            const t = thumbMap[acc.id] ?? imagesOf(acc)[0];
                            return (
                              <div key={acc.sku} className="flex flex-col rounded-lg border border-border bg-background p-3">
                                <ThumbSlot onVisible={() => requestImages(acc.id)}>
                                  <button
                                    onClick={() => { requestImages(acc.id); setDetailSku(acc.sku); }}
                                    className="grid h-28 w-full place-items-center overflow-hidden rounded-md bg-muted"
                                  >
                                    {t ? (
                                      <ArticleImage src={t} alt={acc.name} className="max-h-24 max-w-[70%] object-contain" />
                                    ) : (
                                      <span className="label-mono text-muted-foreground">Produktbild</span>
                                    )}
                                  </button>
                                </ThumbSlot>
                                <span className="label-mono mt-3 truncate text-muted-foreground">{acc.level1}</span>
                                <button onClick={() => setDetailSku(acc.sku)} className="mt-1 text-left text-sm font-semibold leading-snug hover:text-accent">
                                  <span className="line-clamp-2">{acc.name}</span>
                                </button>
                                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                                  <span className="font-mono text-sm font-bold">{eur(priceForQty(acc, acc.moq))}</span>
                                  <button
                                    onClick={() => addLine(acc.sku, acc.moq)}
                                    className="rounded-md border border-border px-2.5 py-1 text-[13px] font-bold hover:border-accent hover:text-accent"
                                  >
                                    + Korb
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
          <div className="relative mt-4">
            {navPending && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-background/60 pt-16">
                <span className="size-8 animate-spin rounded-full border-[3px] border-accent/30 border-t-accent" />
              </div>
            )}
            {!brandPick && !search.q.trim() && (data.highlights ?? []).length > 0 && (
              <HighlightStage
                items={data.highlights}
                thumbFor={(a) => thumbMap[a.id] ?? imagesOf(a)[0]}
                requestImages={requestImages}
                onAdd={(a) => addLine(a.sku, a.moq)}
                onOpen={(a) => {
                  requestImages(a.id);
                  setDetailSku(a.sku);
                }}
              />
            )}
            {brandPick && (
              <p className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-accent bg-accent/10 px-4 py-3 text-sm">
                <span>Alle Artikel von <strong>{brandPick}</strong></span>
                <button type="button" className="font-medium underline" onClick={() => setBrandPick(null)}>
                  Hersteller-Auswahl aufheben
                </button>
              </p>
            )}
            {searchFallback && !search.category && search.q.trim() === searchFallback.q && (
              <p className="mb-4 rounded-lg border border-accent bg-accent/10 px-4 py-3 text-sm">
                Im Bereich <strong>{searchFallback.from}</strong> wurde für „{searchFallback.q}“ nichts gefunden.{" "}
                {rows.length > 0
                  ? `Die Suche wurde unter allen Artikeln fortgesetzt: ${num(data.total)} Treffer in anderen Bereichen.`
                  : "Auch unter allen Artikeln gibt es keine Treffer."}
              </p>
            )}
            {rows.length === 0 && (
              <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-muted-foreground">
                {search.q
                  ? `Keine Treffer für „${search.q}“ in dieser Auswahl.`
                  : "Keine Artikel für diese Auswahl."}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {rows.map((row) =>
                row.kind === "single" ? (
                  renderArticleCard(row.article)
                ) : (
                  <Fragment key={`g-${row.id}`}>
                    {renderGroupCard(row)}
                    {openGroups[row.id] && (
                      <div className="col-span-full rounded-lg border border-accent/40 bg-muted/40 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">
                            {row.name}{" "}
                            <span className="label-mono text-muted-foreground">
                              · {row.variants.length} Varianten
                            </span>
                          </p>
                          <button
                            onClick={() => toggleGroup(row.id)}
                            className="text-xs font-semibold text-muted-foreground hover:text-accent"
                          >
                            Schließen ×
                          </button>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                          {row.variants.map((variant) => renderArticleCard(variant))}
                        </div>
                      </div>
                    )}
                  </Fragment>
                ),
              )}
            </div>
          </div>
          )}
        </main>

        <aside id="order" className="lg:sticky lg:top-36 lg:self-start">
          <div className="rounded-lg border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="label-mono text-muted-foreground">Warenkorb</span>
              <span className="font-mono text-[11px] text-accent">
                {detailedLines.length} Positionen
              </span>
            </div>

            {data.user && (
              <div className="border-b border-border px-4 py-3">
                <Link
                  to="/bestellungen"
                  className="block rounded-sm border border-border px-3 py-2 text-center text-[13px] font-semibold hover:border-accent hover:text-accent"
                >
                  Meine Bestellungen
                </Link>
              </div>
            )}

            {basketNote && (
              <p className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
                {basketNote}
                {!data.user && (
                  <>
                    {" "}
                    <Link to="/anmelden" className="font-semibold text-accent">
                      Anmelden
                    </Link>
                  </>
                )}
              </p>
            )}


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
              <input
                value={orderRef}
                onChange={(e) => setOrderRef(e.target.value)}
                placeholder="Ihre Bestellnummer (optional)"
                maxLength={80}
                className="mt-4 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
              />
              {priceDiffs && priceDiffs.length > 0 && (
                <div className="mt-3 rounded-sm border border-accent/50 bg-accent/10 px-3 py-2 text-[13px]">
                  <p className="font-semibold text-accent">
                    Preise haben sich geändert — bitte prüfen
                  </p>
                  <ul className="mt-1 space-y-1 text-foreground">
                    {priceDiffs.map((diff) => (
                      <li key={diff.sku} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{diff.sku}</span>
                        <span className="font-mono">
                          <span className="text-muted-foreground line-through">
                            {eur(diff.stored)}
                          </span>{" "}
                          {eur(diff.current)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => void refreshPrices()}
                    disabled={basketBusy}
                    className="mt-2 w-full rounded-sm border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  >
                    Preise übernehmen
                  </button>
                </div>
              )}
              <button
                onClick={submitOrder}
                disabled={basketBusy || !activeBasket || lines.length === 0}
                className="mt-2 w-full rounded-sm bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {basketBusy ? "Wird gesendet …" : "Bestellung absenden"}
              </button>

              {orderDone && (
                <p className="mt-2 rounded-sm border border-stock/40 bg-stock/10 px-3 py-2 text-[13px] text-stock">
                  {orderDone}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      <BrandMarquee
        onSelect={(brand) => {
          setBrandPick(brand);
          setPromoOnly(false);
          setFavOnly(false);
          setMakerFilter([]);
          setTerm("");
          void navigate({
            search: (prev) => ({ ...prev, artikel: "", category: "", subcategory: "", subsubcategory: "", q: "" }),
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <footer className="border-t border-border bg-panel">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
          <span>MAWA Trading · Distributor · Belieferung ausschließlich B2B</span>
          <span className="font-mono text-[12px]">
            Bestände und Preise live aus dem ERP · Version {SHOP_VERSION}
          </span>
        </div>
      </footer>

    </div>
  );
}
