/**
 * Zugang zum Shop anfordern.
 *
 * Ablauf:
 *  1. Kundennummer in weclapp prüfen (Kategorie + hinterlegte E-Mail).
 *  2. Berechtigt  → POST /v1/shop/auth/signup  (Backend schickt Link zum Passwortsetzen).
 *  3. Nicht berechtigt → Registrierungsanfrage vermerken, wird im CRM behandelt.
 */
import { apiBase, appOrigin } from "./shop-auth.server";
import { query } from "./db.server";

/** Kategorien ohne Shop-Zugang. */
const BLOCKED_CATEGORIES = ["bronze", "privat", "influencer"];

export type EligibilityResult = {
  found: boolean;
  customerNumber: string;
  company: string | null;
  category: string | null;
  email: string | null;
  allowed: boolean;
  reason: "not_found" | "category" | "no_email" | "blocked" | null;
};

type CustomerRow = {
  customer_number: string | null;
  company: string | null;
  category: string | null;
  email: string | null;
  blocked: boolean | null;
};

const CUSTOMER_SQL = `
  select c.customer_number,
         coalesce(nullif(c.company, ''), trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))) as company,
         nullif(c.customer_category_name, '') as category,
         nullif(trim(pe.to_addresses), '') as email,
         c.blocked
    from weclapp.customer c
    left join weclapp.party_email_address pe
           on pe.party_id = c.id and pe._idx = 0

   where regexp_replace(upper(coalesce(c.customer_number, '')), '[^A-Z0-9]', '', 'g') = $1
      or regexp_replace(upper(coalesce(c.old_customer_number, '')), '[^A-Z0-9]', '', 'g') = $1
      or regexp_replace(upper(coalesce(c.customer_number, '')), '[^A-Z0-9]', '', 'g') = 'KN' || $1
      or regexp_replace(upper(coalesce(c.old_customer_number, '')), '[^A-Z0-9]', '', 'g') = 'KN' || $1
   limit 1

`;

export async function checkEligibility(customerNumber: string): Promise<EligibilityResult> {
  const number = customerNumber.trim();
  const base: EligibilityResult = {
    found: false,
    customerNumber: number,
    company: null,
    category: null,
    email: null,
    allowed: false,
    reason: "not_found",
  };
  if (!number) return base;

  const rows = await query<CustomerRow>(CUSTOMER_SQL, [
    number.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  ]);


  const row = rows[0];
  if (!row) return base;

  const category = row.category ?? null;
  const key = (category ?? "").toLowerCase();
  const blockedCategory = BLOCKED_CATEGORIES.some((needle) => key.includes(needle));
  const email = row.email ?? null;

  const reason: EligibilityResult["reason"] = row.blocked
    ? "blocked"
    : blockedCategory
      ? "category"
      : !email
        ? "no_email"
        : null;

  return {
    found: true,
    customerNumber: row.customer_number?.trim() || number,
    company: row.company?.trim() || null,
    category,
    email,
    allowed: reason === null,
    reason,
  };
}


/** Shop-Zugang beim Backend anlegen lassen. */
export async function apiSignup(
  customerNumber: string,
): Promise<{ status: string; hint: string | null }> {
  const res = await fetch(`${apiBase()}/v1/shop/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appOrigin() },
    body: JSON.stringify({ customerNumber }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SIGNUP_FAILED_${res.status}`);
  const body = (await res.json()) as { status?: unknown; hint?: unknown };
  return {
    status: typeof body.status === "string" ? body.status : "pending",
    hint: typeof body.hint === "string" ? body.hint : null,
  };
}

/** Anfrage für die Bearbeitung im CRM vermerken. */
export async function apiRecordRegistration(input: {
  customerNumber: string;
  email?: string | null;
  note: string;
}): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/shop-registrations`, {
    method: "POST",
    headers: { origin: appOrigin(), "content-type": "application/json" },
    body: JSON.stringify({
      customerNumber: input.customerNumber,
      email: input.email ?? null,
      note: input.note,
      status: "pending",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`REGISTRATION_FAILED_${res.status}`);
}
