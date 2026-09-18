import { createServerFn } from "@tanstack/react-start";

export type SimpleResult = { ok: true } | { ok: false; error: string };

/** Neues Passwort mit dem Link-Token setzen. */
export const setShopPassword = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; password: string }) => ({
    token: String(data?.token ?? "").trim(),
    password: String(data?.password ?? ""),
  }))
  .handler(async ({ data }): Promise<SimpleResult> => {
    if (!data.token) return { ok: false, error: "Der Link ist unvollständig oder abgelaufen." };
    if (data.password.length < 8) {
      return { ok: false, error: "Das Passwort muss mindestens 8 Zeichen lang sein." };
    }

    const { apiBase, appOrigin } = await import("./shop-auth.server");
    try {
      const res = await fetch(`${apiBase()}/v1/shop/auth/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: appOrigin() },
        body: JSON.stringify({ token: data.token, password: data.password }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return { ok: true };
      if (res.status === 400) {
        return {
          ok: false,
          error:
            "Der Link ist nicht mehr gültig oder das Passwort ist zu einfach. Bitte fordern Sie einen neuen Link an.",
        };
      }
      return { ok: false, error: "Passwort konnte nicht gesetzt werden. Bitte später erneut versuchen." };
    } catch {
      return { ok: false, error: "Verbindung nicht möglich. Bitte später erneut versuchen." };
    }
  });

/** Neuen Link zum Passwortsetzen anfordern (E-Mail-Adresse des Zugangs). */
export const requestShopPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string }) => ({ email: String(data?.email ?? "").trim() }))
  .handler(async ({ data }): Promise<SimpleResult> => {
    if (!data.email.includes("@")) {
      return { ok: false, error: "Bitte eine gültige E-Mail-Adresse eingeben." };
    }
    const { apiBase, appOrigin } = await import("./shop-auth.server");
    try {
      await fetch(`${apiBase()}/v1/shop/auth/forgot-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: appOrigin() },
        body: JSON.stringify({ email: data.email }),
        signal: AbortSignal.timeout(20_000),
      });
      // Aus Sicherheitsgründen immer dieselbe Rückmeldung.
      return { ok: true };
    } catch {
      return { ok: false, error: "Verbindung nicht möglich. Bitte später erneut versuchen." };
    }
  });
