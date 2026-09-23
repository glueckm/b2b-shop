/**
 * Generischer E-Mail-Versand über das MAWA-Backend.
 *
 * Erwarteter Endpunkt (Backend):
 *   POST /v1/shop/emails
 *   Body: { to, subject, text, html?, replyTo?, cc?, bcc? }
 *   Antwort: 202 { status: "accepted" }  |  400 { error: "…" }
 *
 * Der Aufruf erfolgt serverseitig mit dem Shop-Servicekonto-Token,
 * damit auch öffentliche Seiten (z. B. /kundenanfrage) senden können.
 */
import { serviceAuthHeaders } from "./mawa-api.server";

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
};

function apiBase(): string {
  const configured = process.env["USER_API_BASE_URL"] ?? "";
  if (!configured || configured.includes("mangari.org")) return "https://mawaapi.mangari.info";
  return configured;
}

export type MailResult = { ok: true } | { ok: false; error: string };

export async function sendMail(message: MailMessage): Promise<MailResult> {
  try {
    const res = await fetch(`${apiBase()}/v1/shop/emails`, {
      method: "POST",
      headers: { ...(await serviceAuthHeaders()), "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 202 || res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `MAIL_API_${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "MAIL_API_FAILED" };
  }
}
