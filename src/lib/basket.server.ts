/**
 * Warenkörbe im MAWA-Backend (/v1/shop/baskets).
 *
 * Es zählt ausschließlich das Token des angemeldeten Kunden — ein Warenkorb
 * gehört immer einem Kunden. Ohne Anmeldung gibt es keine Backend-Warenkörbe.
 */

import { readToken } from "./shop-auth.server";

export type BasketLine = {
  articleId: string;
  articleNumber: string;
  name: string | null;
  quantity: number;
  priceShown: number | null;
};

export type Basket = {
  id: string;
  name: string;
  status: string;
  lineCount: number;
  units: number;
  shownTotal: number;
  updatedAt: string;
  orderNumber: string | null;
  lines: BasketLine[] | null;
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

const numberOf = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function mapLine(raw: Record<string, unknown>): BasketLine {
  return {
    articleId: String(raw["articleId"] ?? ""),
    articleNumber: String(raw["articleNumber"] ?? ""),
    name: raw["name"] === null || raw["name"] === undefined ? null : String(raw["name"]),
    quantity: numberOf(raw["quantity"]),
    priceShown:
      raw["priceShown"] === null || raw["priceShown"] === undefined
        ? null
        : numberOf(raw["priceShown"]),
  };
}

function mapBasket(raw: Record<string, unknown>): Basket {
  const linesRaw = raw["lines"];
  return {
    id: String(raw["id"] ?? ""),
    name: String(raw["name"] ?? "Warenkorb"),
    status: String(raw["status"] ?? "open"),
    lineCount: numberOf(raw["lineCount"]),
    units: numberOf(raw["units"]),
    shownTotal: numberOf(raw["shownTotal"]),
    updatedAt: String(raw["updatedAt"] ?? ""),
    orderNumber:
      raw["orderNumber"] === null || raw["orderNumber"] === undefined
        ? null
        : String(raw["orderNumber"]),
    lines: Array.isArray(linesRaw)
      ? linesRaw.map((line) => mapLine((line ?? {}) as Record<string, unknown>))
      : null,
  };
}

async function call(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: init.method ?? "GET",
    headers: headers(),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("SHOP_LOGIN_REQUIRED");
  if (!res.ok) throw new Error(`BASKET_API_${res.status}`);
  if (res.status === 204) return null;
  return (await res.json()) as unknown;
}

const asRows = (parsed: unknown): Record<string, unknown>[] => {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  const items = (parsed as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
};

/** Alle Warenkörbe des Kunden, neueste Aktivität zuerst. */
export async function listBaskets(status?: string): Promise<Basket[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return asRows(await call(`/v1/shop/baskets${query}`)).map(mapBasket);
}

/** Ein Warenkorb inklusive Positionen. */
export async function getBasket(basketId: string): Promise<Basket> {
  return mapBasket((await call(`/v1/shop/baskets/${encodeURIComponent(basketId)}`)) as Record<
    string,
    unknown
  >);
}

export async function createBasket(name: string): Promise<Basket> {
  return mapBasket(
    (await call("/v1/shop/baskets", { method: "POST", body: { name } })) as Record<string, unknown>,
  );
}

export async function renameBasket(basketId: string, name: string): Promise<Basket> {
  return mapBasket(
    (await call(`/v1/shop/baskets/${encodeURIComponent(basketId)}`, {
      method: "PATCH",
      body: { name },
    })) as Record<string, unknown>,
  );
}

/** Warenkorb aufgeben (bleibt im Backend erhalten). */
export async function abandonBasket(basketId: string): Promise<void> {
  await call(`/v1/shop/baskets/${encodeURIComponent(basketId)}`, { method: "DELETE" });
}

/** Warenkorb kopieren — auch alte: das "nochmals kaufen". */
export async function copyBasket(basketId: string, name?: string): Promise<Basket> {
  return mapBasket(
    (await call(`/v1/shop/baskets/${encodeURIComponent(basketId)}/copy`, {
      method: "POST",
      body: name ? { name } : {},
    })) as Record<string, unknown>,
  );
}

/** Artikel setzen (Upsert: erneutes Senden setzt die Menge). */
export async function putLine(
  basketId: string,
  line: {
    articleId: string;
    articleNumber: string;
    quantity: number;
    name?: string | null | undefined;
    priceShown?: number | null | undefined;
    salesChannel?: string | null | undefined;
  },
): Promise<Basket> {
  return mapBasket(
    (await call(`/v1/shop/baskets/${encodeURIComponent(basketId)}/lines`, {
      method: "PUT",
      body: {
        articleId: line.articleId,
        articleNumber: line.articleNumber,
        quantity: line.quantity,
        ...(line.name ? { name: line.name.slice(0, 400) } : {}),
        ...(line.priceShown === null || line.priceShown === undefined
          ? {}
          : { priceShown: line.priceShown }),
        ...(line.salesChannel ? { salesChannel: line.salesChannel } : {}),
      },
    })) as Record<string, unknown>,
  );
}

export async function deleteLine(basketId: string, articleId: string): Promise<Basket> {
  return mapBasket(
    (await call(
      `/v1/shop/baskets/${encodeURIComponent(basketId)}/lines/${encodeURIComponent(articleId)}`,
      { method: "DELETE" },
    )) as Record<string, unknown>,
  );
}
