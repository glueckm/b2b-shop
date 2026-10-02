import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getMyOrders, getOrderDocumentPdf, getOrderDocuments, type OrderDocument } from "@/lib/orders.functions";
import type { CustomerOrder } from "@/lib/orders.server";

export const Route = createFileRoute("/bestellungen")({
  head: () => ({
    meta: [
      { title: "Meine Bestellungen — MAWA Trading Distribution" },
      { name: "description", content: "Aufträge, Lieferungen, Rechnungen und Rückstände im Überblick." },
      { property: "og:title", content: "Meine Bestellungen — MAWA Trading Distribution" },
      { property: "og:description", content: "Auftragsübersicht für MAWA-Fachhandelspartner." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async () => {
    const orders = await getMyOrders().catch(() => null);
    if (!orders) throw redirect({ to: "/anmelden" });
    return { orders };
  },
  component: OrdersPage,
});

const money = (v: number, cur = "EUR") =>
  new Intl.NumberFormat("de-AT", { style: "currency", currency: cur || "EUR" }).format(v);
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("de-AT") : "–");

/** Gemeinsame Spalten für Überschrift und Auftragszeilen. */
const ROW_GRID =
  "flex flex-wrap items-center gap-3 md:grid md:grid-cols-[8rem_6rem_minmax(0,1fr)_minmax(0,1.2fr)_23rem_7rem]";

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span
      className={`rounded-sm px-2.5 py-1 text-sm font-semibold ${
        ok ? "bg-stock/15 text-stock" : "bg-muted text-muted-foreground"
      }`}
    >
      {ok ? yes : no}
    </span>
  );
}

const DOC_LABEL: Record<OrderDocument["kind"], string> = {
  "order-confirmation": "Auftragsbestätigung",
  "delivery-note": "Lieferschein",
  invoice: "Rechnung",
};

function DocLink({ orderId, doc }: { orderId: string; doc: OrderDocument }) {
  const label = `${DOC_LABEL[doc.kind]}${doc.number ? ` ${doc.number}` : ""}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    // Direkter Download: Brave blockiert blob-Adressen in neuen Tabs (ERR_BLOCKED_BY_CLIENT).
    setBusy(true);
    setError(null);
    try {
      const r = await getOrderDocumentPdf({ data: { orderId, kind: doc.kind, id: doc.id } });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${label.replace(/[^\w\-. äöüÄÖÜß]/g, "_")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Beleg derzeit nicht verfügbar");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className="rounded-sm border border-border px-2 py-1 text-[12px] font-semibold hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {busy ? "Lädt …" : `↓ ${label}`}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function OrderCard({ order }: { order: CustomerOrder }) {
  const [open, setOpen] = useState(false);
  const inWork = order.status === "ORDER_ENTRY_IN_PROGRESS";
  const pending = order.status === "SUBMITTED";
  const [docs, setDocs] = useState<OrderDocument[] | null | "error">(null);
  useEffect(() => {
    if (!open || docs !== null || pending) return;
    getOrderDocuments({ data: { orderId: order.id } })
      .then((r) => setDocs(r.ok ? r.documents : "error"))
      .catch(() => setDocs("error"));
  }, [open, docs, order.id]);
  return (
    <div className="rounded-sm border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`${ROW_GRID} w-full px-4 py-3 text-left`}
      >
        <span className="font-mono text-sm font-semibold">
          {pending ? (order.number ? `AB ${order.number}` : "Abgeschickt") : order.number}
        </span>
        <span className="text-sm text-muted-foreground">{day(order.date)}</span>
        <span className="truncate text-xs text-muted-foreground">{order.customerRef ?? ""}</span>
        <span className="truncate font-mono text-xs">
          {order.invoices.map((i) => i.transportRef).filter(Boolean).join(", ")}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {pending ? (
            <Badge ok={false} yes="" no="Nicht bestätigt" />
          ) : (
            <Badge ok={!inWork} yes="Angelegt" no="In Erfassung" />
          )}
          {!order.shipped && order.items.some((i) => i.shipped > 0) ? (
            <span className="rounded-sm bg-low/15 px-2.5 py-1 text-sm font-semibold text-low">Teillieferung</span>
          ) : (
            <Badge ok={order.shipped} yes="Geliefert" no="Nicht geliefert" />
          )}
          <Badge ok={order.paid} yes="Bezahlt" no="Offen" />
        </span>
        <span className="text-right font-mono text-sm">{money(order.net, order.currency)}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {pending && <span className="text-xs text-muted-foreground">Ihre Bestellung ist eingegangen und wird von MAWA geprüft. Belege folgen nach der Bestätigung.</span>}
            {!pending && docs === null && <span className="text-xs text-muted-foreground">Belege werden geladen …</span>}
            {docs === "error" && <span className="text-xs text-muted-foreground">Belege derzeit nicht verfügbar.</span>}
            {Array.isArray(docs) && docs.length === 0 && (
              <span className="text-xs text-muted-foreground">Keine Belege vorhanden.</span>
            )}
            {Array.isArray(docs) && docs.map((d) => <DocLink key={`${d.kind}-${d.id}`} orderId={order.id} doc={d} />)}
          </div>
          {order.invoices.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">
              {order.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {order.invoices.length > 1 ? `Rechnung ${inv.number} · ` : ""}
                    <strong className="font-semibold">Transportreferenz:</strong>
                  </span>
                  <span>{inv.transportRef ?? "keine Referenz verfügbar"}</span>
                  {inv.transportRef && (
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(inv.transportRef!)}
                      className="rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      title="Transportreferenz kopieren"
                    >
                      Kopieren
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <table className="w-full text-sm">
            <thead className="label-mono text-left text-muted-foreground">
              <tr>
                <th className="py-1">Artikel</th>
                <th className="py-1 text-right">Menge</th>
                <th className="py-1 text-right">Geliefert</th>
                <th className="py-1 text-right">Offen</th>
                <th className="py-1 text-right">Preis</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i, idx) => (
                <tr key={idx} className="border-t border-border">
                  <td className="py-1.5">
                    <span className="font-mono text-xs text-muted-foreground">{i.sku}</span> {i.title}
                  </td>
                  <td className="py-1.5 text-right">{i.quantity}</td>
                  <td className="py-1.5 text-right">{i.shipped}</td>
                  <td className={`py-1.5 text-right ${i.open > 0 ? "font-semibold text-accent" : ""}`}>
                    {i.open}
                  </td>
                  <td className="py-1.5 text-right font-mono">{money(i.unitPrice, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrdersPage() {
  const { orders } = Route.useLoaderData();
  const [tab, setTab] = useState<"orders" | "backlog">("orders");
  const backlog = orders
    .filter((o) => o.status !== "CLOSED" && o.status !== "MANUALLY_CLOSED")
    .flatMap((o) => o.items.filter((i) => i.open > 0).map((i) => ({ order: o, item: i })));

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-12">
      <Link to="/" className="rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground">
        ← Zurück zum Einkaufen
      </Link>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Meine Bestellungen</h1>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-2">
          {([
            ["orders", `Aufträge (${orders.length})`],
            ["backlog", `Rückstände (${backlog.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-sm border px-3 py-1.5 text-sm font-semibold ${
                tab === key ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <a
            href="https://www.post.at/s/sendungssuche"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            Zur Sendungsverfolgung
          </a>
          <p className="text-xs text-muted-foreground">
            Kopieren Sie dafür Ihre Transportreferenz der jeweiligen Lieferung.
          </p>
        </div>
      </div>

      {tab === "orders" ? (
        <div className="mt-4 space-y-2">
          {orders.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Aufträge vorhanden.</p>}
          {orders.length > 0 && (
            <div className={`${ROW_GRID} label-mono hidden px-4 pb-1 text-muted-foreground md:grid`}>
              <span>Auftrag</span>
              <span>Datum</span>
              <span>Ihre Referenz</span>
              <span>Sendungsnummer</span>
              <span>Status</span>
              <span className="text-right">Betrag netto</span>
            </div>
          )}
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-sm border border-border bg-card p-4">
          {backlog.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine offenen Rückstände.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="label-mono text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Auftrag</th>
                  <th className="py-1">Artikel</th>
                  <th className="py-1 text-right">Bestellt</th>
                  <th className="py-1 text-right">Offen</th>
                </tr>
              </thead>
              <tbody>
                {backlog.map(({ order, item }, idx) => (
                  <tr key={idx} className="border-t border-border">
                    <td className="py-1.5 font-mono text-xs">
                      {order.number}
                      <div className="text-muted-foreground">{day(order.date)}</div>
                    </td>
                    <td className="py-1.5">
                      <span className="font-mono text-xs text-muted-foreground">{item.sku}</span> {item.title}
                    </td>
                    <td className="py-1.5 text-right">{item.quantity}</td>
                    <td className="py-1.5 text-right font-semibold text-accent">{item.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </main>
  );
}
