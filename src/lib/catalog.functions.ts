import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const priceGroups = [
  { channel: "NET1", label: "Silber" },
  { channel: "NET2", label: "Gold" },
  { channel: "NET3", label: "Platin" },
  { channel: "NET13", label: "MAWA DE Bronze" },
  { channel: "NET12", label: "MAWA AT Bronze" },
  { channel: "NET14", label: "Sub-Distribution" },
] as const;

export type PriceBreak = { from: number; price: number };

export type CatalogArticle = {
  id: string;
  sku: string;
  name: string;
  spec: string;
  category: string;
  unit: string;
  moq: number;
  onHand: number;
  breaks: PriceBreak[];
};

export type CatalogPayload = {
  /** Bild-URLs je Artikel-ID (aus dem MAWA-Backend). */
  images: Record<string, string[]>;
  /** Kleines Vorschaubild je Artikel-ID für die Listenansicht. */
  thumbs: Record<string, string>;
  articles: CatalogArticle[];
  total: number;
  categories: { name: string; count: number }[];
  stats: { articles: number; categories: number; onHand: number };
};

const inputSchema = z.object({
  channel: z.string().default("NET1"),
  category: z.string().default(""),
  search: z.string().default(""),
});

const ARTICLES_SQL = `
with tier as (
  select article_id,
         jsonb_agg(jsonb_build_object('from', price_scale_value, 'price', price)
                   order by price_scale_value) as breaks
  from weclapp.article_price
  where sales_channel = $1
    and price > 0
    and (start_date is null or start_date <= now())
    and (end_date is null or end_date > now())
  group by article_id
),
stock as (
  select article_id, sum(quantity) as qty
  from weclapp.warehouse_stock
  where warehouse_id = '3566' -- nur Hauptlager
  group by article_id
)
select a.id as id,
       a.article_number as sku,
       a.name,
       coalesce(nullif(a.short_description1, ''), nullif(a.description, ''), '') as spec,
       coalesce(c.name, 'Ohne Kategorie') as category,
       coalesce(nullif(a.unit_name, ''), 'Stk.') as unit,
       greatest(coalesce(a.minimum_purchase_quantity, 1), 1)::float8 as moq,
       coalesce(s.qty, 0)::float8 as on_hand,
       t.breaks
from weclapp.article a
join tier t on t.article_id = a.id
left join weclapp.article_category c on c.id = a.article_category_id
join stock s on s.article_id = a.id
left join weclapp.article_status st on st.id = a.status_id
where a.active and a.available_in_sale
  and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
  -- nur Artikel mit Bestand im Hauptlager
  and s.qty > 0
  and ($2 = '' or c.name = $2)
  and ($3 = '' or a.article_number ilike '%' || $3 || '%' or a.name ilike '%' || $3 || '%')
order by coalesce(s.qty, 0) desc, a.article_number
limit 400


`;

const COUNT_SQL = `
select count(*)::int as total
from weclapp.article a
left join weclapp.article_category c on c.id = a.article_category_id
left join weclapp.article_status st on st.id = a.status_id
where a.active and a.available_in_sale
  and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
  and coalesce((select sum(w.quantity) from weclapp.warehouse_stock w
    where w.article_id = a.id and w.warehouse_id = '3566'), 0) > 0

  and exists (
    select 1 from weclapp.article_price p
    where p.article_id = a.id and p.sales_channel = $1 and p.price > 0
      and (p.start_date is null or p.start_date <= now())
      and (p.end_date is null or p.end_date > now())
  )
  and ($2 = '' or c.name = $2)
  and ($3 = '' or a.article_number ilike '%' || $3 || '%' or a.name ilike '%' || $3 || '%')
`;

const CATEGORIES_SQL = `
select coalesce(c.name, 'Ohne Kategorie') as name, count(*)::int as count
from weclapp.article a
left join weclapp.article_category c on c.id = a.article_category_id
where a.active and a.available_in_sale
  and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
group by 1
order by count desc, name
limit 18
`;

const STATS_SQL = `
select (select count(*)::int from weclapp.article where active and available_in_sale
          and (ca_de_webshop_on_off or ca_at_webshop_on_off)) as articles,
       (select count(distinct article_category_id)::int from weclapp.article
         where active and available_in_sale and article_category_id is not null
           and (ca_de_webshop_on_off or ca_at_webshop_on_off)) as categories,
       (select coalesce(sum(w.quantity), 0)::float8 from weclapp.warehouse_stock w
         join weclapp.article a on a.id = w.article_id
         where a.active and a.available_in_sale
           and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)) as on_hand
`;

// --- Fuzzy Search (Trigramm-Ähnlichkeit, da pg_trgm auf der Replica nicht verfügbar ist) ---
function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\-_.]/g, "");
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) out.add(padded.slice(i, i + 3));
  return out;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 3 && (b.includes(a) || a.includes(b))) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

const SIMILARITY_THRESHOLD = 0.3;

export const getCatalog = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => inputSchema.parse(data ?? {}))
  .handler(async ({ data }): Promise<CatalogPayload> => {
    const { query } = await import("./db.server");
    const params = [data.channel, data.category, ""];

    const [articles, counts, categories, stats] = await Promise.all([
      query<{
        id: string;
        sku: string;
        name: string;
        spec: string;
        category: string;
        unit: string;
        moq: number;
        on_hand: number;
        breaks: PriceBreak[];
      }>(ARTICLES_SQL, params),
      query<{ total: number }>(COUNT_SQL, params),
      query<{ name: string; count: number }>(CATEGORIES_SQL),
      query<{ articles: number; categories: number; on_hand: number }>(STATS_SQL),
    ]);

    let mapped: CatalogArticle[] = articles.map((row) => ({
      id: String(row.id),
      sku: row.sku,
      name: row.name,
      spec: row.spec,
      category: row.category,
      unit: row.unit,
      moq: Math.max(1, Math.round(row.moq)),
      onHand: Math.round(row.on_hand),
      breaks: (row.breaks ?? [])
        .map((b) => ({ from: Number(b.from), price: Number(b.price) }))
        .sort((a, b) => a.from - b.from),
    }));

    const term = normalizeTerm(data.search);
    if (term) {
      mapped = mapped
        .map((article) => {
          const targets = [
            normalizeTerm(article.name),
            normalizeTerm(article.sku),
            ...`${article.name} ${article.sku}`
              .split(/[^\p{L}\p{N}]+/u)
              .map(normalizeTerm)
              .filter(Boolean),
          ];
          const score = targets.reduce((best, target) => Math.max(best, similarity(term, target)), 0);
          return { article, score };
        })
        .filter((entry) => entry.score >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.score - a.score || a.article.name.localeCompare(b.article.name))
        .map((entry) => entry.article);
    }

    let images: Record<string, string[]> = {};
    // Kleines Vorschaubild je Artikel für die Listenansicht.
    const thumbs: Record<string, string> = {};
    try {
      const { listArticleImages } = await import("./mawa-api.server");
      const { articleImageUrl } = await import("./article-images.functions");
      const { isThumbFileName } = await import("./resize-image");
      const grouped = await listArticleImages();
      for (const [articleId, files] of Object.entries(grouped)) {
        const full = files.filter((file) => !isThumbFileName(file.filename));
        const thumb = files.find((file) => isThumbFileName(file.filename));
        if (full.length > 0) images[articleId] = full.map((file) => articleImageUrl(file.id));
        if (thumb) thumbs[articleId] = articleImageUrl(thumb.id);
      }
    } catch {
      images = {};
    }

    return {
      images,
      thumbs,
      articles: mapped,
      total: term ? mapped.length : (counts[0]?.total ?? 0),
      categories,
      stats: {
        articles: stats[0]?.articles ?? 0,
        categories: stats[0]?.categories ?? 0,
        onHand: Math.round(stats[0]?.on_hand ?? 0),
      },
    };
  });
