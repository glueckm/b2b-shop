import { createServerFn } from "@tanstack/react-start";

import type { CustomerOrder } from "./orders.server";

/** Aufträge des angemeldeten Kunden (Kundennummer aus dem geprüften Login). */
export const getMyOrders = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerOrder[] | null> => {
    const { apiCurrentUser } = await import("./shop-auth.server");
    const user = await apiCurrentUser();
    if (!user?.customerNumber) return null;
    const { withDbSession } = await import("./db.server");
    const { customerOrders } = await import("./orders.server");
    return withDbSession((s) => customerOrders(user.customerNumber!, s.query));
  },
);

export type OrderDocument = {
  kind: "order-confirmation" | "delivery-note" | "invoice";
  id: string;
  number: string;
  date: string | null;
};

/** Belege eines Auftrags (Auftragsbestätigung, Lieferscheine, Rechnungen) aus dem Backend. */
export const getOrderDocuments = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => {
    const id = String((raw as { orderId?: unknown })?.orderId ?? "");
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(id)) throw new Error("Ungültige Auftragsnummer");
    return { orderId: id };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; documents: OrderDocument[] }> => {
    const { readToken, apiBase, appOrigin } = await import("./shop-auth.server");
    const token = readToken();
    if (!token) return { ok: false, documents: [] };
    try {
      const res = await fetch(`${apiBase()}/v1/shop/orders/${data.orderId}/documents`, {
        headers: { authorization: `Bearer ${token}`, origin: appOrigin() },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, documents: [] };
      const body = (await res.json()) as unknown;
      // Antwort tolerant lesen: Liste direkt, unter "documents"/"items" oder je Art gruppiert.
      const rows: Array<Record<string, unknown>> = [];
      const push = (v: unknown, kind?: string) => {
        if (Array.isArray(v)) v.forEach((x) => push(x, kind));
        else if (v && typeof v === "object") rows.push({ kind, ...(v as Record<string, unknown>) });
      };
      if (Array.isArray(body)) push(body);
      else if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if (b["documents"] ?? b["items"]) push(b["documents"] ?? b["items"]);
        else {
          push(b["orderConfirmation"] ?? b["order_confirmation"] ?? b["order-confirmation"], "order-confirmation");
          push(b["deliveryNotes"] ?? b["delivery_notes"] ?? b["delivery-note"], "delivery-note");
          push(b["invoices"] ?? b["invoice"], "invoice");
        }
      }
      const norm = (k: unknown): OrderDocument["kind"] | null => {
        const s = String(k ?? "").toLowerCase().replace(/[_\s]/g, "-");
        if (s.includes("confirm")) return "order-confirmation";
        if (s.includes("delivery")) return "delivery-note";
        if (s.includes("invoice")) return "invoice";
        return null;
      };
      const documents: OrderDocument[] = [];
      for (const r of rows) {
        const kind = norm(r["kind"] ?? r["type"] ?? r["documentType"]);
        const id = String(r["id"] ?? r["documentId"] ?? r["entityId"] ?? "");
        if (!kind || !id) continue;
        documents.push({
          kind,
          id,
          number: String(r["number"] ?? r["documentNumber"] ?? r["name"] ?? ""),
          date: (r["date"] ?? r["documentDate"] ?? null) as string | null,
        });
      }
      return { ok: true, documents };
    } catch {
      return { ok: false, documents: [] };
    }
  });
