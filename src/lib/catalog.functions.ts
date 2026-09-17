import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const priceGroups = [
  { channel: "", label: "Kein Vertriebsweg (Listenpreis)" },
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
  /** Langtext aus weclapp (Lieferumfang). */
  scope: string;
  category: string;
  /** Oberste Kategorie-Ebene (z. B. NOCPIX). */
  level1: string;
  /** Zweite Kategorie-Ebene (z. B. NOCPIX-TH). */
  level2: string;
  /** Dritte Kategorie-Ebene. */
  level3: string;
  unit: string;

  moq: number;
  onHand: number;
  breaks: PriceBreak[];
  /** Rabatt des Vertriebswegs (Preisgruppe) für die Warengruppe des Artikels, in Prozent. */
  rebatePct: number;
  /** Variantenartikel (Mutter) — leer, wenn der Artikel keine Variante ist. */
  groupId: string;
  groupSku: string;
  groupName: string;
};


export type CategoryLeaf = { name: string; count: number };

export type CategoryChild = { name: string; count: number; children: CategoryLeaf[] };

export type CategoryNode = {
  name: string;
  count: number;
  children: CategoryChild[];
};


export type CatalogPayload = {
  /** Bild-URLs je Artikel-ID (aus dem MAWA-Backend). */
  images: Record<string, string[]>;
  /** Kleines Vorschaubild je Artikel-ID für die Listenansicht. */
  thumbs: Record<string, string>;
  articles: CatalogArticle[];
  total: number;
  categories: { name: string; count: number }[];
  /** Zweistufige Menüführung: Ebene 1 mit ihren Ebene-2-Kategorien. */
  categoryTree: CategoryNode[];
  stats: { articles: number; categories: number; onHand: number };
};

const inputSchema = z.object({
  channel: z.string().default("NET1"),
  category: z.string().default(""),
  subcategory: z.string().default(""),
  subsubcategory: z.string().default(""),
  search: z.string().default(""),
});



/** Kategoriepfad: Ebene 1 (Wurzel) und Ebene 2 (zweite Stufe). */
const CATEGORY_PATH_CTE = `
cat as (
  select c.id,
         p.id as pid,
         pp.id as ppid,
         c.name as leaf,
         coalesce(pp.name, p.name, c.name) as level1,
         coalesce(case when pp.id is not null then p.name
                       when p.id is not null then c.name end, '') as level2
  from weclapp.article_category c
  left join weclapp.article_category p on p.id = c.parent_category_id
  left join weclapp.article_category pp on pp.id = p.parent_category_id
)
`;

/** Vertriebsweg-Rabatte (weclapp „rebate"): Prozent je Warengruppe, aktuell gültig. */
const REBATE_CTE = `
reb_all as (
  select rc.id as category_id,
         r.value as pct,
         row_number() over (partition by rc.id
           order by r.start_date desc nulls last, r.last_modified_date desc) as rn
  from weclapp.rebate r
  join weclapp.rebate_article_category rc on rc._parent_rid = r._rid
  where r.sales_channel = $5
    and r.type = 'REDUCTION_PERCENT'
    and coalesce(r.customer_id, '') = ''
    and (r.start_date is null or r.start_date <= now())
    and (r.end_date is null or r.end_date > now())
),
reb as (select category_id, pct from reb_all where rn = 1)
`;

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
),
-- Variantenartikel (Mutter) je Einzelartikel
variant as (
  select vv.article_id,
         v.id as group_id,
         v.variant_article_number as group_sku,
         v.variant_article_name as group_name
  from weclapp.variant_article_variant vv
  join weclapp.variant_article v on v.id = vv.variant_article_id
),
${REBATE_CTE},
${CATEGORY_PATH_CTE}

select a.id as id,
       a.article_number as sku,
       a.name,
       coalesce(nullif(a.short_description1, ''), nullif(a.description, ''), '') as spec,
       coalesce(a.long_text, '') as scope,
       coalesce(cat.leaf, 'Ohne Kategorie') as category,
       coalesce(nullif(a.ca_level1, ''), 'Ohne Zuordnung') as level1,
       coalesce(a.ca_level2, '') as level2,
       coalesce(nullif(a.unit_name, ''), 'Stk.') as unit,
       greatest(coalesce(a.minimum_purchase_quantity, 1), 1)::float8 as moq,
       coalesce(s.qty, 0)::float8 as on_hand,
       t.breaks,
       coalesce(vr.group_id, '') as group_id,
       coalesce(vr.group_sku, '') as group_sku,
       coalesce(vr.group_name, '') as group_name,
       coalesce(r1.pct, r2.pct, r3.pct, 0)::float8 as rebate_pct
from weclapp.article a
join tier t on t.article_id = a.id
left join cat on cat.id = a.article_category_id
left join reb r1 on r1.category_id = cat.id
left join reb r2 on r2.category_id = cat.pid
left join reb r3 on r3.category_id = cat.ppid
left join variant vr on vr.article_id = a.id
join stock s on s.article_id = a.id
where a.active and a.available_in_sale
  and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
  -- nur Artikel mit Bestand im Hauptlager
  and s.qty > 0
  and ($2 = '' or coalesce(nullif(a.ca_level1, ''), 'Ohne Zuordnung') = $2)
  and ($4 = '' or coalesce(a.ca_level2, '') = $4)
  and ($3 = '' or a.article_number ilike '%' || $3 || '%' or a.name ilike '%' || $3 || '%')
order by coalesce(vr.group_sku, ''), coalesce(s.qty, 0) desc, a.article_number
limit 400

`;

const COUNT_SQL = `
with ${CATEGORY_PATH_CTE}
-- Variantenartikel zählen als eine Position
select count(distinct coalesce(
         (select vv.variant_article_id from weclapp.variant_article_variant vv
           where vv.article_id = a.id limit 1), a.id))::int as total
from weclapp.article a
left join cat on cat.id = a.article_category_id

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
  and ($2 = '' or coalesce(nullif(a.ca_level1, ''), 'Ohne Zuordnung') = $2)
  and ($4 = '' or coalesce(a.ca_level2, '') = $4)
  and ($3 = '' or a.article_number ilike '%' || $3 || '%' or a.name ilike '%' || $3 || '%')
  and ($5::text is not null or true) -- $5 = Vertriebsweg für Rabatte (hier ungenutzt)
`;

const MAIN_STOCK_EXISTS = `
  coalesce((select sum(w.quantity) from weclapp.warehouse_stock w
    where w.article_id = a.id and w.warehouse_id = '3566'), 0) > 0
`;

/** Ebene 1 und Ebene 2 mit Artikelzahlen (nur Artikel mit Hauptlager-Bestand). */
const CATEGORY_TREE_SQL = `
select coalesce(nullif(a.ca_level1, ''), 'Ohne Zuordnung') as level1,
       coalesce(a.ca_level2, '') as level2,
       count(*)::int as count
from weclapp.article a
where a.active and a.available_in_sale
  and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
  and ${MAIN_STOCK_EXISTS}
group by 1, 2
order by 1, 2
`;



const STATS_SQL = `
select (select count(*)::int from weclapp.article a where a.active and a.available_in_sale
          and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
          and ${MAIN_STOCK_EXISTS}) as articles,
       (select count(distinct a.article_category_id)::int from weclapp.article a
         where a.active and a.available_in_sale and a.article_category_id is not null
           and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
           and ${MAIN_STOCK_EXISTS}) as categories,
       (select coalesce(sum(w.quantity), 0)::float8 from weclapp.warehouse_stock w
         join weclapp.article a on a.id = w.article_id
         where a.active and a.available_in_sale and w.warehouse_id = '3566'
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
    // Ohne Vertriebsweg: Listenpreise (NET1-Preisliste) ohne Konditionsrabatt.
    const priceChannel = data.channel || "NET1";
    const params = [priceChannel, data.category, "", data.subcategory, data.channel];

    const [articles, counts, treeRows, stats] = await Promise.all([
      query<{
        id: string;
        sku: string;
        name: string;
        spec: string;
        scope: string;
        category: string;
        level1: string;
        level2: string;
        unit: string;
        moq: number;
        on_hand: number;
        breaks: PriceBreak[];
        rebate_pct: number;
        group_id: string;
        group_sku: string;
        group_name: string;


      }>(ARTICLES_SQL, params),
      query<{ total: number }>(COUNT_SQL, params),
      query<{ level1: string; level2: string; count: number }>(CATEGORY_TREE_SQL),
      query<{ articles: number; categories: number; on_hand: number }>(STATS_SQL),
    ]);

    const treeMap = new Map<string, CategoryNode>();
    for (const row of treeRows) {
      const node = treeMap.get(row.level1) ?? { name: row.level1, count: 0, children: [] };
      node.count += row.count;
      if (row.level2) node.children.push({ name: row.level2, count: row.count });
      treeMap.set(row.level1, node);
    }
    const categoryTree = [...treeMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    for (const node of categoryTree) {
      node.children.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
    const categories = categoryTree.map((node) => ({ name: node.name, count: node.count }));


    let mapped: CatalogArticle[] = articles.map((row) => {
      // Vertriebsweg-Rabatt der Warengruppe auf die Listenpreise anwenden.
      const pct = Number(row.rebate_pct ?? 0);
      const factor = 1 - pct / 100;
      return {
        id: String(row.id),
        sku: row.sku,
        name: row.name,
        spec: row.spec,
        scope: row.scope ?? "",
        category: row.category,
        level1: row.level1,
        level2: row.level2,

        unit: row.unit,
        moq: Math.max(1, Math.round(row.moq)),
        onHand: Math.round(row.on_hand),
        breaks: (row.breaks ?? [])
          .map((b) => ({
            from: Number(b.from),
            price: Math.round(Number(b.price) * factor * 100) / 100,
          }))
          .sort((a, b) => a.from - b.from),
        rebatePct: pct,
        groupId: row.group_id ?? "",
        groupSku: row.group_sku ?? "",
        groupName: row.group_name ?? "",
      };
    });



    const term = normalizeTerm(data.search);
    if (term) {
      mapped = mapped
        .map((article) => {
          const targets = [
            normalizeTerm(article.name),
            normalizeTerm(article.sku),
            normalizeTerm(article.groupName),
            normalizeTerm(article.groupSku),
            ...`${article.name} ${article.sku} ${article.groupName}`
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
      categoryTree,

      stats: {
        articles: stats[0]?.articles ?? 0,
        categories: stats[0]?.categories ?? 0,
        onHand: Math.round(stats[0]?.on_hand ?? 0),
      },
    };
  });
