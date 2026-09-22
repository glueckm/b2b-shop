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
  .inputValidator((data: { customerNumber: string; password: string }) => ({
    customerNumber: String(data?.customerNumber ?? "").trim(),
    password: String(data?.password ?? ""),
  }))
  .handler(async ({ data }): Promise<AuthResult> => {
    if (!data.customerNumber || !data.password) {
      return { ok: false, error: "Bitte Kundennummer und Passwort eingeben." };
    }
    const { apiLogin, storeToken, storeCustomerNumber } = await import("./shop-auth.server");
    try {
      storeToken(await apiLogin(data.customerNumber, data.password));
      storeCustomerNumber(data.customerNumber);
      // Kein Vorwärmen des Katalogs: der Seitenlader baut ihn ohnehin auf,
      // ein zweiter Aufbau würde die gleichen Abfragen doppelt ausführen.
      return { ok: true };
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const message = /BAD_CREDENTIALS|invalid|401/i.test(raw)
        ? "Kundennummer oder Passwort ist nicht korrekt."
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

/** Anzeigename und/oder Passwort des angemeldeten Kontos ändern. */
export const shopUpdateAccount = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      displayName?: string | undefined;
      password?: string | undefined;
      currentPassword?: string | undefined;
    }) => ({

      displayName: data?.displayName === undefined ? undefined : String(data.displayName).trim(),
      password: data?.password ? String(data.password) : undefined,
      currentPassword: data?.currentPassword ? String(data.currentPassword) : undefined,
    }),
  )
  .handler(
    async ({ data }): Promise<{ ok: true; user: ShopUser } | { ok: false; error: string }> => {
      if (data.displayName === undefined && !data.password) {
        return { ok: false, error: "Bitte einen Anzeigenamen oder ein neues Passwort angeben." };
      }
      if (data.password && data.password.length < 8) {
        return { ok: false, error: "Das neue Passwort muss mindestens 8 Zeichen haben." };
      }
      const { apiUpdateMe } = await import("./shop-auth.server");
      try {
        const user = await apiUpdateMe(data);
        return { ok: true, user };
      } catch (error) {
        const raw = error instanceof Error ? error.message : "";
        if (/NOT_AUTHENTICATED|401/i.test(raw)) {
          return { ok: false, error: "Bitte erneut anmelden." };
        }
        return {
          ok: false,
          error: raw && raw !== "UPDATE_FAILED" ? raw : "Änderung konnte nicht gespeichert werden.",
        };
      }
    },
  );
