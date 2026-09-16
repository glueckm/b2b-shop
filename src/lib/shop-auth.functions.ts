import { createServerFn } from "@tanstack/react-start";

import type { ShopUser } from "./shop-auth.server";

export type { ShopUser };

export type AuthResult = { ok: true } | { ok: false; error: string };

/** Angemeldeter Kunde (oder null). */
export const getShopUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<ShopUser | null> => {
    const { apiCurrentUser } = await import("./shop-auth.server");
    return apiCurrentUser();
  },
);

export const shopLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => ({
    email: String(data?.email ?? "").trim(),
    password: String(data?.password ?? ""),
  }))
  .handler(async ({ data }): Promise<AuthResult> => {
    if (!data.email || !data.password) {
      return { ok: false, error: "Bitte E-Mail und Passwort eingeben." };
    }
    const { apiLogin, storeToken } = await import("./shop-auth.server");
    try {
      storeToken(await apiLogin(data.email, data.password));
      return { ok: true };
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const message = /BAD_CREDENTIALS|401/i.test(raw)
        ? "E-Mail oder Passwort ist nicht korrekt."
        : "Anmeldung derzeit nicht möglich. Bitte später erneut versuchen.";
      return { ok: false, error: message };
    }
  });

export const shopLogout = createServerFn({ method: "POST" }).handler(
  async (): Promise<AuthResult> => {
    const { apiLogout } = await import("./shop-auth.server");
    await apiLogout();
    return { ok: true };
  },
);
