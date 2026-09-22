/**
 * Preisgruppe (Vertriebsweg) des angemeldeten Kunden aus weclapp.
 *
 * In weclapp trägt jeder Kunde seinen Vertriebsweg (customer.sales_channel,
 * z. B. NET6) sowie seine Preisgruppe/Kategorie (customer_category_name,
 * z. B. PLATIN). Der Shop rechnet ausschließlich mit diesen Werten – es gibt
 * keine Auswahl im Frontend mehr.
 */
import { query, type DbSession } from "./db.server";

export type CustomerPricing = {
  /** Vertriebsweg für die Preise, z. B. "NET6". */
  channel: string;
  /** Bezeichnung der Preisgruppe, z. B. "PLATIN". */
  group: string | null;
  company: string | null;
  customerNumber: string | null;
};

type Row = {
  customer_number: string | null;
  company: string | null;
  category: string | null;
  sales_channel: string | null;
};

const SQL = `
  select c.customer_number,
         coalesce(nullif(c.company, ''), trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))) as company,
         nullif(c.customer_category_name, '') as category,
         nullif(c.sales_channel, '') as sales_channel
    from weclapp.customer c
   where regexp_replace(upper(coalesce(c.customer_number, '')), '[^A-Z0-9]', '', 'g') = $1
      or regexp_replace(upper(coalesce(c.old_customer_number, '')), '[^A-Z0-9]', '', 'g') = $1
      or regexp_replace(upper(coalesce(c.customer_number, '')), '[^A-Z0-9]', '', 'g') = 'KN' || $1
      or regexp_replace(upper(coalesce(c.old_customer_number, '')), '[^A-Z0-9]', '', 'g') = 'KN' || $1
   limit 1
`;

/** Fallback, wenn der Kunde nicht gefunden wird: Listenpreise ohne Vertriebsweg. */
const FALLBACK: CustomerPricing = {
  channel: "NET1",
  group: null,
  company: null,
  customerNumber: null,
};

/** Kurzzeit-Cache: die Preisgruppe ändert sich selten, spart eine DB-Abfrage je Seitenaufbau. */
const cacheRef = globalThis as typeof globalThis & {
  __mawaPricingCache?: Map<string, { at: number; value: CustomerPricing }>;
};
const PRICING_TTL = 5 * 60 * 1000;

export async function customerPricing(
  customerNumber: string | null | undefined,
  session?: DbSession,
): Promise<CustomerPricing> {
  const number = (customerNumber ?? "").trim();
  if (!number) return FALLBACK;

  const cache = (cacheRef.__mawaPricingCache ??= new Map());
  const hit = cache.get(number);
  if (hit && Date.now() - hit.at < PRICING_TTL) return hit.value;

  try {
    const rows = await query<Row>(
      SQL,
      [number.toUpperCase().replace(/[^A-Z0-9]/g, "")],
      session,
    );
    const row = rows[0];
    if (!row) return { ...FALLBACK, customerNumber: number };
    const value: CustomerPricing = {
      channel: row.sales_channel?.trim() || FALLBACK.channel,
      group: row.category?.trim() || null,
      company: row.company?.trim() || null,
      customerNumber: row.customer_number?.trim() || number,
    };
    cache.set(number, { at: Date.now(), value });
    return value;
  } catch {
    return { ...FALLBACK, customerNumber: number };
  }
}
