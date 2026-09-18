/** Server-Funktionen für die Favoriten des angemeldeten Kunden. */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Favourite } from "./favourites.server";

export type { Favourite } from "./favourites.server";

export type FavouriteState =
  | { ok: true; favourites: Favourite[] }
  | { ok: false; reason: "login" | "error"; message?: string };

function fail(error: unknown): FavouriteState {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "SHOP_LOGIN_REQUIRED") return { ok: false, reason: "login" };
  console.error("[favourites]", message);
  return { ok: false, reason: "error", message };
}

async function state(): Promise<FavouriteState> {
  const api = await import("./favourites.server");
  try {
    return { ok: true, favourites: await api.listFavourites() };
  } catch (error) {
    return fail(error);
  }
}

const idSchema = z.object({ articleId: z.string().min(1).max(64) });

export const loadFavourites = createServerFn({ method: "POST" }).handler(
  async (): Promise<FavouriteState> => state(),
);

export const markFavourite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }): Promise<FavouriteState> => {
    const api = await import("./favourites.server");
    try {
      await api.markFavourite(data.articleId);
    } catch (error) {
      const failed = fail(error);
      if (failed.ok === false && failed.reason === "login") return failed;
    }
    return state();
  });

export const unmarkFavourite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data }): Promise<FavouriteState> => {
    const api = await import("./favourites.server");
    try {
      await api.unmarkFavourite(data.articleId);
    } catch (error) {
      const failed = fail(error);
      if (failed.ok === false && failed.reason === "login") return failed;
    }
    return state();
  });
