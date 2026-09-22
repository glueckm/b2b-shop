import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DbSession } from "./db.server";

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


export type CatalogUser = {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  customerNumber: string | null;
  isSuperuser: boolean;
};

export type CatalogPayload = {
  /** Angemeldeter Kunde – null bedeutet: nicht angemeldet. */
  user: CatalogUser | null;
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
  /** Preisgruppe/Vertriebsweg des angemeldeten Kunden (nur Anzeige + Preisbasis). */
  pricing: { channel: string; group: string | null; company: string | null };
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

/** Ebenen-Werte je Variantenfamilie: in weclapp sind LEVEL1-3 oft nur bei einer Variante gepflegt. */
const GLEVEL_CTE = `
glevel as (
  select vv.variant_article_id as group_id,
         max(nullif(a2.ca_level1, '')) as l1,
         max(nullif(a2.ca_level2, '')) as l2,
         max(nullif(a2.ca_level3, '')) as l3
  from weclapp.variant_article_variant vv
  join weclapp.article a2 on a2.id = vv.article_id
  group by 1
)
`;
// Keine Vererbung innerhalb der Variantenfamilie: die Werte kommen 1:1 aus weclapp.
const EFF_L1 = `coalesce(nullif(a.ca_level1, ''), 'Ohne Zuordnung')`;
const EFF_L2 = `coalesce(a.ca_level2, '')`;
const EFF_L3 = `coalesce(a.ca_level3, '')`;



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
${GLEVEL_CTE},
${REBATE_CTE},
${CATEGORY_PATH_CTE}

select a.id as id,
       a.article_number as sku,
       a.name,
       coalesce(nullif(a.short_description1, ''), nullif(a.description, ''), '') as spec,
       coalesce(a.long_text, '') as scope,
       coalesce(cat.leaf, 'Ohne Kategorie') as category,
       ${EFF_L1} as level1,
       ${EFF_L2} as level2,
       ${EFF_L3} as level3,

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
left join glevel g on g.group_id = vr.group_id
left join stock s on s.article_id = a.id
where a.active and a.available_in_sale
  and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
  -- Einzelartikel nur mit Bestand im Hauptlager; Varianten immer (auch nicht lagernd, bestellbar)
  and (vr.group_id is not null or coalesce(s.qty, 0) > 0)
  and ($2 = '' or ${EFF_L1} = $2)
  and ($4 = '' or ${EFF_L2} = $4)
  and ($6 = '' or ${EFF_L3} = $6)

  and ($3 = '' or a.article_number ilike '%' || $3 || '%' or a.name ilike '%' || $3 || '%')
order by coalesce(vr.group_sku, ''), coalesce(s.qty, 0) desc, a.article_number
limit 600


`;

const MAIN_STOCK_EXISTS = `
  coalesce((select sum(w.quantity) from weclapp.warehouse_stock w
    where w.article_id = a.id and w.warehouse_id = '3566'), 0) > 0
`;

/** Ebene 1, 2 und 3 mit Artikelzahlen (nur Artikel mit Hauptlager-Bestand). */
const CATEGORY_TREE_SQL = `
with ${GLEVEL_CTE}
select ${EFF_L1} as level1,
       ${EFF_L2} as level2,
       ${EFF_L3} as level3,
       count(*)::int as count
from weclapp.article a
left join weclapp.variant_article_variant vg on vg.article_id = a.id
left join glevel g on g.group_id = vg.variant_article_id
where a.active and a.available_in_sale
  and (a.ca_de_webshop_on_off or a.ca_at_webshop_on_off)
  and ${MAIN_STOCK_EXISTS}
group by 1, 2, 3
order by 1, 2, 3
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

type CatalogFilter = { category: string; subcategory: string; subsubcategory: string };

type CatalogSnapshot = {
  articles: CatalogArticle[];
  total: number;
  categories: { name: string; count: number }[];
  categoryTree: CategoryNode[];
  stats: { articles: number; categories: number; onHand: number };
};

/**
 * Katalog-Cache: für alle Kunden derselben Preisgruppe und desselben Filters
 * sind die Daten identisch. Frische Daten werden direkt geliefert, ältere
 * werden sofort ausgeliefert und im Hintergrund erneuert (stale-while-revalidate),
 * damit niemand auf die Datenbank warten muss.
 */
type CacheEntry<T> = { at: number; value: T };

const cacheRef = globalThis as typeof globalThis & {
  __mawaCatalogSnapshots?: Map<string, CacheEntry<CatalogSnapshot>>;
  __mawaCatalogInflight?: Map<string, Promise<CatalogSnapshot>>;
  __mawaCatalogMeta?: CacheEntry<CatalogMeta>;
  __mawaCatalogMetaInflight?: Promise<CatalogMeta> | undefined;
};

/** Daten gelten so lange als frisch. */
const SNAPSHOT_TTL = 300_000;
/** Kategorien/Kennzahlen ändern sich selten. */
const META_TTL = 900_000;

type CatalogMeta = {
  categories: { name: string; count: number }[];
  categoryTree: CategoryNode[];
  stats: { articles: number; categories: number; onHand: number };
};

async function buildMeta(session?: DbSession): Promise<CatalogMeta> {
  const { query } = await import("./db.server");
  const [treeRows, stats] = await Promise.all([
    query<{ level1: string; level2: string; level3: string; count: number }>(
      CATEGORY_TREE_SQL,
      [],
      session,
    ),
    query<{ articles: number; categories: number; on_hand: number }>(STATS_SQL, [], session),
  ]);

  const treeMap = new Map<string, CategoryNode>();
  for (const row of treeRows) {
    const node = treeMap.get(row.level1) ?? { name: row.level1, count: 0, children: [] };
    node.count += row.count;
    if (row.level2) {
      let child = node.children.find((c) => c.name === row.level2);
      if (!child) {
        child = { name: row.level2, count: 0, children: [] };
        node.children.push(child);
      }
      child.count += row.count;
      if (row.level3) {
        const leaf = child.children.find((l) => l.name === row.level3);
        if (leaf) leaf.count += row.count;
        else child.children.push({ name: row.level3, count: row.count });
      }
    }
    treeMap.set(row.level1, node);
  }
  const byCount = (a: { name: string; count: number }, b: { name: string; count: number }) =>
    b.count - a.count || a.name.localeCompare(b.name);
  const categoryTree = [...treeMap.values()].sort(byCount);
  for (const node of categoryTree) {
    node.children.sort(byCount);
    for (const child of node.children) child.children.sort(byCount);
  }
  return {
    categories: categoryTree.map((node) => ({ name: node.name, count: node.count })),
    categoryTree,
    stats: {
      articles: stats[0]?.articles ?? 0,
      categories: stats[0]?.categories ?? 0,
      onHand: Math.round(stats[0]?.on_hand ?? 0),
    },
  };
}

function catalogMeta(session?: DbSession): CatalogMeta | Promise<CatalogMeta> {
  const hit = cacheRef.__mawaCatalogMeta;
  const fresh = hit && Date.now() - hit.at < META_TTL;
  if (!fresh && !cacheRef.__mawaCatalogMetaInflight) {
    cacheRef.__mawaCatalogMetaInflight = buildMeta(session)
      .then((value) => {
        cacheRef.__mawaCatalogMeta = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        cacheRef.__mawaCatalogMetaInflight = undefined;
      });
  }
  // Vorhandene Daten sofort ausliefern, auch wenn im Hintergrund erneuert wird.
  if (hit) return hit.value;
  return cacheRef.__mawaCatalogMetaInflight!;
}

async function buildArticles(
  priceChannel: string,
  filter: CatalogFilter,
  session?: DbSession,
): Promise<{ articles: CatalogArticle[]; total: number }> {
  const { query } = await import("./db.server");
  const params = [
    priceChannel,
    filter.category,
    "",
    filter.subcategory,
    priceChannel,
    filter.subsubcategory,
  ];

  const articles = await query<{
      id: string;
      sku: string;
      name: string;
      spec: string;
      scope: string;
      category: string;
      level1: string;
      level2: string;
      level3: string;
      unit: string;
      moq: number;
      on_hand: number;
      breaks: PriceBreak[];
      rebate_pct: number;
      group_id: string;
      group_sku: string;
      group_name: string;
    }>(ARTICLES_SQL, params, session);

  const mapped: CatalogArticle[] = articles.map((row) => {
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
      level3: row.level3 ?? "",
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

  // Die Liste enthält bereits alle sichtbaren Artikel (maximal 600). Varianten
  // zählen wie in der Darstellung als eine Familie; eine zweite SQL-Abfrage
  // nur für dieselbe Zahl ist daher unnötig.
  const total = new Set(mapped.map((article) => article.groupId || article.id)).size;
  return { articles: mapped, total };
}

async function buildSnapshot(
  priceChannel: string,
  filter: CatalogFilter,
  session?: DbSession,
): Promise<CatalogSnapshot> {
  const [list, meta] = await Promise.all([
    buildArticles(priceChannel, filter, session),
    catalogMeta(session),
  ]);
  return { ...list, ...meta };
}

export async function catalogSnapshot(
  priceChannel: string,
  filter: CatalogFilter,
  session?: DbSession,
): Promise<CatalogSnapshot> {
  const cache = (cacheRef.__mawaCatalogSnapshots ??= new Map());
  const inflight = (cacheRef.__mawaCatalogInflight ??= new Map());
  const key = [priceChannel, filter.category, filter.subcategory, filter.subsubcategory].join("|");
  const hit = cache.get(key);
  const fresh = hit && Date.now() - hit.at < SNAPSHOT_TTL;

  if (!fresh && !inflight.has(key)) {
    // Nur wenn wir selbst auf die Daten warten, darf die Anfrage-Verbindung
    // mitbenutzt werden – eine Hintergrund-Erneuerung überlebt die Anfrage.
    const task = buildSnapshot(priceChannel, filter, hit ? undefined : session)
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, task);
    // Hintergrund-Erneuerung darf keinen unbehandelten Fehler auslösen.
    if (hit) void task.catch(() => undefined);
  }

  if (hit) return hit.value;
  return inflight.get(key)!;
}



export const getCatalog = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => inputSchema.parse(data ?? {}))
  .handler(async ({ data }): Promise<CatalogPayload> => {
    const { withDbSession } = await import("./db.server");
    // Alle Datenbankabfragen dieser Anfrage teilen eine Verbindung.
    return withDbSession((session) => buildPayload(data, session));
  });

async function buildPayload(
  data: {
    category: string;
    subcategory: string;
    subsubcategory: string;
    search: string;
  },
  session?: DbSession,
): Promise<CatalogPayload> {
  {
    const { apiCurrentUser, readCustomerNumber } = await import("./shop-auth.server");
    const { customerPricing } = await import("./customer-pricing.server");
    // Anmeldung und Preisgruppe in einem Zug – ein Aufruf statt zwei.
    const user = await apiCurrentUser();
    if (!user) {
      return {
        user: null,
        images: {},
        thumbs: {},
        articles: [],
        total: 0,
        categories: [],
        categoryTree: [],
        pricing: { channel: "NET1", group: null, company: null },
        stats: { articles: 0, categories: 0, onHand: 0 },
      };
    }
    const pricing = await customerPricing(readCustomerNumber(), session);
    const priceChannel = pricing.channel || "NET1";
    const snapshot = await catalogSnapshot(
      priceChannel,
      {
        category: data.category,
        subcategory: data.subcategory,
        subsubcategory: data.subsubcategory,
      },
      session,
    );
    const { categories, categoryTree, stats } = snapshot;
    let mapped: CatalogArticle[] = snapshot.articles;



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

    // Bilder werden nicht mehr im Katalog geladen (das war langsam), sondern
    // nachträglich portionsweise vom Browser über getArticleImageMap.
    const images: Record<string, string[]> = {};
    const thumbs: Record<string, string> = {};

    return {
      user,
      images,
      thumbs,
      articles: mapped,
      total: term ? mapped.length : snapshot.total,
      categories,
      categoryTree,
      pricing: { channel: priceChannel, group: pricing.group, company: pricing.company },
      stats,
    };
  }
}
