/**
 * Generischer E-Mail-Versand über das MAWA-Backend.
 *
 * Endpunkt: POST /v1/service/emails
 * Authentifizierung: festes Service-Token (Secret MAWA_SERVICE_TOKEN),
 * kein Login nötig.
 * Body: { to, subject, text, html?, replyTo?, cc?, bcc? }
 */

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
  const token = process.env["MAWA_SERVICE_TOKEN"];
  if (!token) return { ok: false, error: "MAWA_SERVICE_TOKEN_MISSING" };
  try {
    const res = await fetch(`${apiBase()}/v1/service/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: process.env["APP_PUBLIC_URL"] ?? "https://mawashop.lovable.app",
      },
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
