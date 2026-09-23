/**
 * Stammdaten des angemeldeten Kunden aus weclapp (nur lesend).
 *
 * Es wird ausschließlich der Kunde zur angemeldeten Kundennummer geladen —
 * keine Suche, keine Fremdkunden.
 */
import type { DbQuery } from "./db.server";

export type CustomerProfile = {
  customerNumber: string | null;
  company: string | null;
  category: string | null;
  salesChannel: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website: string | null;
  vatId: string | null;
  paymentTerm: string | null;
  currency: string | null;
  address: {
    street: string | null;
    zipcode: string | null;
    city: string | null;
    state: string | null;
    countryCode: string | null;
  } | null;
};

type Row = {
  customer_number: string | null;
  company: string | null;
  category: string | null;
  sales_channel: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone1: string | null;
  website: string | null;
  vat_registration_number: string | null;
  term_of_payment_name: string | null;
  currency_name: string | null;
  street1: string | null;
  zipcode: string | null;
  city: string | null;
  state: string | null;
  country_code: string | null;
};

const SQL = `
  with c as (
    select *
      from weclapp.customer c
     where regexp_replace(upper(coalesce(c.customer_number, '')), '[^A-Z0-9]', '', 'g') = $1
        or regexp_replace(upper(coalesce(c.old_customer_number, '')), '[^A-Z0-9]', '', 'g') = $1
        or regexp_replace(upper(coalesce(c.customer_number, '')), '[^A-Z0-9]', '', 'g') = 'KN' || $1
        or regexp_replace(upper(coalesce(c.old_customer_number, '')), '[^A-Z0-9]', '', 'g') = 'KN' || $1
     limit 1
  )
  select c.customer_number,
         coalesce(nullif(c.company, ''), trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))) as company,
         nullif(c.customer_category_name, '') as category,
         nullif(c.sales_channel, '') as sales_channel,
         nullif(c.email, '') as email,
         nullif(c.phone, '') as phone,
         nullif(c.mobile_phone1, '') as mobile_phone1,
         nullif(c.website, '') as website,
         nullif(c.vat_registration_number, '') as vat_registration_number,
         nullif(c.term_of_payment_name, '') as term_of_payment_name,
         nullif(c.currency_name, '') as currency_name,
         nullif(a.street1, '') as street1,
         nullif(a.zipcode, '') as zipcode,
         nullif(a.city, '') as city,
         nullif(a.state, '') as state,
         nullif(a.country_code, '') as country_code
    from c
    left join lateral (
      select *
        from weclapp.customer_address a
       where a.customer_id = c.id
       order by a.prime_address desc nulls last, a.invoice_address desc nulls last, a._idx
       limit 1
    ) a on true
`;

export async function customerProfile(
  customerNumber: string | null | undefined,
  sessionQuery: DbQuery,
): Promise<CustomerProfile | null> {
  const number = (customerNumber ?? "").trim();
  if (!number) return null;
  const rows = await sessionQuery<Row>(SQL, [number.toUpperCase().replace(/[^A-Z0-9]/g, "")]);
  const row = rows[0];
  if (!row) return null;
  const address =
    row.street1 || row.zipcode || row.city
      ? {
          street: row.street1,
          zipcode: row.zipcode,
          city: row.city,
          state: row.state,
          countryCode: row.country_code,
        }
      : null;
  return {
    customerNumber: row.customer_number ?? number,
    company: row.company,
    category: row.category,
    salesChannel: row.sales_channel,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile_phone1,
    website: row.website,
    vatId: row.vat_registration_number,
    paymentTerm: row.term_of_payment_name,
    currency: row.currency_name,
    address,
  };
}
