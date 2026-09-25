/**
 * Aufträge, Rechnungen und Rückstände des angemeldeten Kunden aus weclapp (nur lesend).
 */
import type { DbQuery } from "./db.server";

export type OrderItem = {
  sku: string;
  title: string;
  quantity: number;
  shipped: number;
  open: number;
  unitPrice: number;
  unit: string;
  plannedDelivery: string | null;
};

export type OrderInvoice = {
  id: string;
  number: string;
  date: string | null;
  dueDate: string | null;
  gross: number;
  paid: boolean;
};

export type CustomerOrder = {
  id: string;
  number: string;
  customerRef: string | null;
  date: string | null;
  status: string;
  net: number;
  gross: number;
  currency: string;
  shipped: boolean;
  invoiced: boolean;
  paid: boolean;
  items: OrderItem[];
  invoices: OrderInvoice[];
};

const CUSTOMER_CTE = `
  cust as (
    select c.id from weclapp.customer c
     where regexp_replace(upper(coalesce(c.customer_number, '')), '[^A-Z0-9]', '', 'g') in ($1, 'KN' || $1)
        or regexp_replace(upper(coalesce(c.old_customer_number, '')), '[^A-Z0-9]', '', 'g') in ($1, 'KN' || $1)
     limit 1
  )
`;

const ORDERS_SQL = `
with ${CUSTOMER_CTE}
select o.id, o.order_number, nullif(o.order_number_at_customer, '') as customer_ref,
       o.order_date, o.status, coalesce(o.net_amount, 0)::float8 as net,
       coalesce(o.gross_amount, 0)::float8 as gross,
       coalesce(o.record_currency_name, 'EUR') as currency,
       coalesce(o.shipped, false) as shipped, coalesce(o.invoiced, false) as invoiced,
       coalesce(o.paid, false) as paid,
       coalesce((select jsonb_agg(jsonb_build_object(
           'sku', coalesce(i.article_number, ''), 'title', coalesce(i.title, ''),
           'quantity', coalesce(i.quantity, 0), 'shipped', coalesce(i.shipped_quantity, 0),
           'unitPrice', coalesce(i.unit_price, 0), 'unit', coalesce(i.unit_name, ''),
           'plannedDelivery', i.planned_delivery_date) order by i._idx)
         from weclapp.sales_order_item i where i._parent_rid = o._rid), '[]'::jsonb) as items,
       coalesce((select jsonb_agg(jsonb_build_object(
           'id', s.id, 'number', s.invoice_number, 'date', s.invoice_date, 'dueDate', s.due_date,
           'gross', coalesce(s.gross_amount, 0), 'paid', coalesce(s.paid, false)) order by s.invoice_date)
         from weclapp.sales_invoice s
        where s.customer_id = o.customer_id and coalesce(s.status, '') <> 'CANCELLED'
          and (s.sales_order_id = o.id or exists (
            select 1 from weclapp.sales_invoice_sales_order so
             where so._parent_rid = s._rid and so.id = o.id))), '[]'::jsonb) as invoices
from weclapp.sales_order o
join cust on cust.id = o.customer_id
where coalesce(o.template, false) = false
  and o.status <> 'CANCELLED'
order by o.order_date desc nulls last
limit 300
`;

export function normalizeNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

type Row = {
  id: string;
  order_number: string;
  customer_ref: string | null;
  order_date: string | Date | null;
  status: string;
  net: number;
  gross: number;
  currency: string;
  shipped: boolean;
  invoiced: boolean;
  paid: boolean;
  items: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function customerOrders(customerNumber: string, query: DbQuery): Promise<CustomerOrder[]> {
  const rows = await query<Row>(ORDERS_SQL, [normalizeNumber(customerNumber)]);
  return rows.map((r) => ({
    id: String(r.id),
    number: r.order_number,
    customerRef: r.customer_ref,
    date: iso(r.order_date),
    status: r.status,
    net: Number(r.net),
    gross: Number(r.gross),
    currency: r.currency,
    shipped: r.shipped,
    invoiced: r.invoiced,
    paid: r.paid,
    items: (r.items ?? []).map((i) => {
      const quantity = Number(i["quantity"] ?? 0);
      const shipped = Number(i["shipped"] ?? 0);
      return {
        sku: String(i["sku"] ?? ""),
        title: String(i["title"] ?? ""),
        quantity,
        shipped,
        open: Math.max(0, quantity - shipped),
        unitPrice: Number(i["unitPrice"] ?? 0),
        unit: String(i["unit"] ?? ""),
        plannedDelivery: iso(i["plannedDelivery"]),
      };
    }),
    invoices: (r.invoices ?? []).map((s) => ({
      id: String(s["id"]),
      number: String(s["number"] ?? ""),
      date: iso(s["date"]),
      dueDate: iso(s["dueDate"]),
      gross: Number(s["gross"] ?? 0),
      paid: Boolean(s["paid"]),
    })),
  }));
}

/** Prüft, ob der Beleg (Auftrag oder Rechnung) dem Kunden gehört. */
export async function ownsDocument(
  customerNumber: string,
  kind: "order" | "invoice",
  id: string,
  query: DbQuery,
): Promise<boolean> {
  const table = kind === "invoice" ? "weclapp.sales_invoice" : "weclapp.sales_order";
  const rows = await query<{ ok: number }>(
    `with ${CUSTOMER_CTE} select 1 as ok from ${table} x join cust on cust.id = x.customer_id where x.id = $2 limit 1`,
    [normalizeNumber(customerNumber), id],
  );
  return rows.length > 0;
}
