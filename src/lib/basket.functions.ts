/** Server-Funktionen für die Warenkörbe des angemeldeten Kunden. */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Basket } from "./basket.server";

export type { Basket, BasketLine } from "./basket.server";

export type BasketState =
  | { ok: true; baskets: Basket[]; active: Basket | null }
  | { ok: false; reason: "login" | "error"; message?: string };

function fail(error: unknown): { ok: false; reason: "login" | "error"; message?: string } {
  const text = error instanceof Error ? error.message : String(error);
  if (text === "SHOP_LOGIN_REQUIRED") return { ok: false, reason: "login" };
  console.error("[basket]", text);
  return { ok: false, reason: "error", message: text };
}

const idSchema = z.object({ basketId: z.string().min(1) });

async function state(activeId?: string): Promise<BasketState> {
  const api = await import("./basket.server");
  try {
    let baskets = (await api.listBaskets("open")).filter((b) => !b.orderNumber);
    // Ohne offenen Warenkorb legen wir automatisch einen an, damit der Kunde
    // sofort Artikel hinzufügen kann.
    if (baskets.length === 0) {
      const created = await api.createBasket(`Warenkorb ${new Date().toLocaleDateString("de-AT")}`);
      baskets = [created];
    }
    const wanted = activeId && baskets.some((b) => b.id === activeId) ? activeId : baskets[0]?.id;
    const active = wanted ? await api.getBasket(wanted) : null;
    return { ok: true, baskets, active };
  } catch (error) {
    return fail(error);
  }
}


/** Warenkorbliste + aktiver Warenkorb mit Positionen. */
export const loadBaskets = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ basketId: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<BasketState> => state(data.basketId));

export const createBasket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ name: z.string().trim().max(80).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<BasketState> => {
    const api = await import("./basket.server");
    try {
      const name =
        data.name && data.name.length > 0
          ? data.name
          : `Warenkorb ${new Date().toLocaleDateString("de-AT")}`;
      const created = await api.createBasket(name);
      return state(created.id);
    } catch (error) {
      return fail(error);
    }
  });

export const renameBasket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ basketId: z.string().min(1), name: z.string().trim().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data }): Promise<BasketState> => {
    const api = await import("./basket.server");
    try {
      await api.renameBasket(data.basketId, data.name);
    } catch {
      /* Zustand wird ohnehin neu geladen */
    }
    return state(data.basketId);
  });

/** Warenkorb aufgeben — er bleibt im Backend erhalten. */
export const abandonBasket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }): Promise<BasketState> => {
    const api = await import("./basket.server");
    try {
      await api.abandonBasket(data.basketId);
    } catch {
      /* Zustand wird ohnehin neu geladen */
    }
    return state();
  });

/** Warenkorb kopieren (nochmals kaufen). */
export const copyBasket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ basketId: z.string().min(1), name: z.string().trim().max(80).optional() })
      .parse(input),
  )
  .handler(async ({ data }): Promise<BasketState> => {
    const api = await import("./basket.server");
    try {
      const copy = await api.copyBasket(data.basketId, data.name);
      return state(copy.id);
    } catch (error) {
      return fail(error);
    }
  });

/** Artikel setzen (erneutes Senden setzt die Menge). */
export const setBasketLine = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        basketId: z.string().min(1),
        articleId: z.string().min(1).max(64),
        articleNumber: z.string().min(1).max(64),
        quantity: z.number().positive(),
        name: z.string().max(400).optional(),
        priceShown: z.number().min(0).optional(),
        salesChannel: z.string().max(32).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<BasketState> => {
    const api = await import("./basket.server");
    try {
      await api.putLine(data.basketId, data);
    } catch (error) {
      const failed = fail(error);
      if (failed.reason === "login") return failed;
    }
    return state(data.basketId);
  });

export const removeBasketLine = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ basketId: z.string().min(1), articleId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<BasketState> => {
    const api = await import("./basket.server");
    try {
      await api.deleteLine(data.basketId, data.articleId);
    } catch {
      /* Zustand wird ohnehin neu geladen */
    }
    return state(data.basketId);
  });
