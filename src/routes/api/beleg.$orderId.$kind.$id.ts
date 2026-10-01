import { createFileRoute } from "@tanstack/react-router";

/**
 * PDF-Download eines Belegs über das Kundenkonto:
 * GET /v1/shop/orders/{orderId}/documents/{kind}/{id}/pdf (Bearer = Shop-Login des Kunden).
 * Das Backend prüft, dass der Beleg zum angemeldeten Kunden gehört.
 */
const KINDS = new Set(["order-confirmation", "delivery-note", "invoice"]);
const SAFE = /^[0-9A-Za-z_-]{1,64}$/;

export const Route = createFileRoute("/api/beleg/$orderId/$kind/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!KINDS.has(params.kind) || !SAFE.test(params.orderId) || !SAFE.test(params.id)) {
          return new Response("Bad request", { status: 400 });
        }
        const { readToken, apiBase, appOrigin } = await import("@/lib/shop-auth.server");
        const token = readToken();
        if (!token) return new Response("Nicht angemeldet", { status: 401 });
        try {
          const res = await fetch(
            `${apiBase()}/v1/shop/orders/${params.orderId}/documents/${params.kind}/${params.id}/pdf`,
            {
              headers: { authorization: `Bearer ${token}`, origin: appOrigin() },
              signal: AbortSignal.timeout(30_000),
            },
          );
          if (!res.ok) {
            return new Response("Beleg derzeit nicht verfügbar", {
              status: res.status === 404 || res.status === 401 || res.status === 403 ? res.status : 502,
            });
          }
          return new Response(res.body, {
            headers: {
              "content-type": res.headers.get("content-type") ?? "application/pdf",
              "content-disposition":
                res.headers.get("content-disposition") ??
                `attachment; filename="${params.kind}-${params.id}.pdf"`,
              "cache-control": "private, no-store",
            },
          });
        } catch {
          return new Response("Beleg derzeit nicht verfügbar", { status: 502 });
        }
      },
    },
  },
});
