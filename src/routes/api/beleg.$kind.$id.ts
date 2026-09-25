import { createFileRoute } from "@tanstack/react-router";

/**
 * PDF-Download von Belegen (Auftragsbestätigung, Lieferschein, Rechnung).
 * Prüft Login und Eigentum, holt das PDF dann über das MAWA-Backend:
 * GET /v1/service/documents/{kind}/{id}  (Header X-API-Key)
 */
const KINDS = {
  auftragsbestaetigung: { backend: "order-confirmation", owner: "order" },
  lieferschein: { backend: "delivery-note", owner: "order" },
  rechnung: { backend: "invoice", owner: "invoice" },
} as const;

export const Route = createFileRoute("/api/beleg/$kind/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const kind = KINDS[params.kind as keyof typeof KINDS];
        if (!kind || !/^[0-9A-Za-z_-]{1,40}$/.test(params.id)) {
          return new Response("Bad request", { status: 400 });
        }
        const { apiCurrentUser } = await import("@/lib/shop-auth.server");
        const user = await apiCurrentUser();
        if (!user?.customerNumber) return new Response("Nicht angemeldet", { status: 401 });
        const { withDbSession } = await import("@/lib/db.server");
        const { ownsDocument } = await import("@/lib/orders.server");
        const owns = await withDbSession((s) =>
          ownsDocument(user.customerNumber!, kind.owner, params.id, s.query),
        );
        if (!owns) return new Response("Nicht gefunden", { status: 404 });

        const base = process.env["USER_API_BASE_URL"];
        const token = process.env["MAWA_SERVICE_TOKEN"];
        if (!base || !token) return new Response("Nicht konfiguriert", { status: 500 });
        try {
          const res = await fetch(`${base}/v1/service/documents/${kind.backend}/${params.id}`, {
            headers: { "x-api-key": token },
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) {
            return new Response("Beleg derzeit nicht verfügbar", { status: res.status === 404 ? 404 : 502 });
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
