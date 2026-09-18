/**
 * Favoriten des angemeldeten Kunden im MAWA-Backend (/v1/shop/favourites).
 * Es zählt ausschließlich das Token des angemeldeten Kunden.
 */

import { readToken } from "./shop-auth.server";

export type Favourite = {
  articleId: string;
  articleNumber: string;
  articleName: string | null;
  addedAt: string | null;
  addedBy: string | null;
};

function apiBase(): string {
  const configured = process.env["USER_API_BASE_URL"] ?? "";
  if (!configured || configured.includes("mangari.org")) return "https://mawaapi.mangari.info";
  return configured;
}

function appOrigin(): string {
  return process.env["APP_PUBLIC_URL"] ?? "https://mawashop.lovable.app";
}

function headers(): Record<string, string> {
  const token = readToken();
  if (!token) throw new Error("SHOP_LOGIN_REQUIRED");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    origin: appOrigin(),
  };
}

async function call(path: string, method = "GET"): Promise<unknown> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: headers(),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("SHOP_LOGIN_REQUIRED");
  if (!res.ok) throw new Error(`FAVOURITES_API_${res.status}`);
  if (res.status === 204) return null;
  return (await res.json()) as unknown;
}

const text = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

function mapFavourite(raw: Record<string, unknown>): Favourite {
  return {
    articleId: String(raw["articleId"] ?? ""),
    articleNumber: String(raw["articleNumber"] ?? ""),
    articleName: text(raw["articleName"]),
    addedAt: text(raw["addedAt"]),
    addedBy: text(raw["addedBy"]),
  };
}

/** Favoriten, neueste zuerst. */
export async function listFavourites(): Promise<Favourite[]> {
  const parsed = await call("/v1/shop/favourites");
  const rows = Array.isArray(parsed)
    ? (parsed as Record<string, unknown>[])
    : Array.isArray((parsed as { items?: unknown } | null)?.items)
      ? ((parsed as { items: Record<string, unknown>[] }).items)
      : [];
  return rows.map((row) => mapFavourite(row ?? {}));
}

export async function markFavourite(articleId: string): Promise<void> {
  await call(`/v1/shop/favourites/${encodeURIComponent(articleId)}`, "PUT");
}

export async function unmarkFavourite(articleId: string): Promise<void> {
  await call(`/v1/shop/favourites/${encodeURIComponent(articleId)}`, "DELETE");
}
