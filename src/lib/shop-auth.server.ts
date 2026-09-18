/**
 * Anmeldung im Shop gegen die Shop-Endpunkte des MAWA-Backends (mawaapi).
 * Das Token liegt ausschließlich in einem httpOnly-Cookie, nie im Browser-JS.
 */
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

export type ShopUser = {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  isSuperuser: boolean;
};

/** Eigener Cookie-Name – bewusst anders als im CRM-Projekt. */
const COOKIE = "mawa_b2b_shop_token";

export function apiBase(): string {
  const configured = process.env["USER_API_BASE_URL"] ?? "";
  // Die alte Adresse mangari.org ist abgeschaltet – immer das Produktiv-Backend nutzen.
  if (!configured || configured.includes("mangari.org")) return "https://mawaapi.mangari.info";
  return configured;
}

export function appOrigin(): string {
  return process.env["APP_PUBLIC_URL"] ?? "https://mawashop.lovable.app";
}

export function readToken(): string | null {
  try {
    return getCookie(COOKIE) ?? null;
  } catch {
    return null;
  }
}

export function storeToken(token: string) {
  setCookie(COOKIE, token, {
    httpOnly: true,
    secure: true,
    // "none", damit das Cookie auch in der Lovable-Vorschau (iframe) gesendet wird.
    sameSite: "none",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearToken() {
  try {
    deleteCookie(COOKIE, { path: "/", secure: true, sameSite: "none" });
  } catch {
    /* ignore */
  }
}

async function detailMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object") {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function mapAccount(raw: Record<string, unknown>): ShopUser {
  const str = (key: string) => (raw[key] ? String(raw[key]) : null);
  return {
    id: String(raw["id"] ?? ""),
    email: String(raw["email"] ?? ""),
    displayName: str("display_name") ?? str("displayName") ?? str("name"),
    firstName: str("first_name") ?? str("firstName"),
    lastName: str("last_name") ?? str("lastName"),
    isSuperuser: raw["is_superuser"] === true,
  };
}

/** Anmeldung mit Kundennummer (wird als "username" gesendet). */
export async function apiLogin(customerNumber: string, password: string): Promise<string> {
  const res = await fetch(`${apiBase()}/v1/shop/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: appOrigin() },
    body: new URLSearchParams({ username: customerNumber, password }).toString(),

    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(await detailMessage(res, "LOGIN_BAD_CREDENTIALS"));
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("LOGIN_FAILED");
  return body.access_token;
}

export async function apiCurrentUser(): Promise<ShopUser | null> {
  const token = readToken();
  if (!token) return null;
  try {
    const res = await fetch(`${apiBase()}/v1/shop/auth/logins/me`, {
      headers: { authorization: `Bearer ${token}`, origin: appOrigin() },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return mapAccount((await res.json()) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Passwort und/oder Anzeigename des angemeldeten Kontos ändern. */
export async function apiUpdateMe(input: {
  displayName?: string | undefined;
  password?: string | undefined;
  currentPassword?: string | undefined;
}): Promise<ShopUser> {

  const token = readToken();
  if (!token) throw new Error("NOT_AUTHENTICATED");

  const payload: Record<string, string> = {};
  if (input.displayName !== undefined) payload["display_name"] = input.displayName;
  if (input.password) payload["password"] = input.password;
  if (input.currentPassword) payload["current_password"] = input.currentPassword;

  const res = await fetch(`${apiBase()}/v1/shop/auth/logins/me`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: appOrigin(),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(await detailMessage(res, "UPDATE_FAILED"));
  return mapAccount((await res.json()) as Record<string, unknown>);
}

export async function apiLogout(): Promise<void> {
  const token = readToken();
  if (token) {
    try {
      await fetch(`${apiBase()}/v1/shop/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, origin: appOrigin() },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      /* Cookie wird trotzdem gelöscht */
    }
  }
  clearToken();
}
