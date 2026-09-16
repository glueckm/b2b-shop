/**
 * Anmeldung im Shop gegen das bestehende MAWA-Backend (mawaapi).
 * Das Token liegt ausschließlich in einem httpOnly-Cookie, nie im Browser-JS.
 */
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

export type ShopUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isSuperuser: boolean;
};

const COOKIE = "mawa_shop_token";

export function apiBase(): string {
  return process.env["USER_API_BASE_URL"] ?? "https://mawaapi.mangari.info";
}

export function appOrigin(): string {
  return process.env["APP_PUBLIC_URL"] ?? "https://mawa-shop.lovable.app";
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
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function apiLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: appOrigin() },
    body: new URLSearchParams({ username: email, password }).toString(),
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
    const res = await fetch(`${apiBase()}/v1/auth/users/me`, {
      headers: { authorization: `Bearer ${token}`, origin: appOrigin() },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      id: String(raw["id"] ?? ""),
      email: String(raw["email"] ?? ""),
      firstName: raw["first_name"] ? String(raw["first_name"]) : null,
      lastName: raw["last_name"] ? String(raw["last_name"]) : null,
      isSuperuser: raw["is_superuser"] === true,
    };
  } catch {
    return null;
  }
}

export async function apiLogout(): Promise<void> {
  const token = readToken();
  if (token) {
    try {
      await fetch(`${apiBase()}/v1/auth/logout`, {
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
