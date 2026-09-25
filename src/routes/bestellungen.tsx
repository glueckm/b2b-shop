import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { getMyOrders } from "@/lib/orders.functions";
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

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-[11px] font-semibold ${
        ok ? "bg-stock/15 text-stock" : "bg-muted text-muted-foreground"
      }`}
    >
      {ok ? yes : no}
    </span>
  );
}

function DocLink({ kind, id, label }: { kind: string; id: string; label: string }) {
  return (
    <a
      href={`/api/beleg/${kind}/${id}`}
      className="rounded-sm border border-border px-2 py-1 text-[12px] font-semibold hover:border-accent hover:text-accent"
    >
      ↓ {label}
    </a>
  );
}

function OrderCard({ order }: { order: CustomerOrder }) {
  const [open, setOpen] = useState(false);
  const inWork = order.status === "ORDER_ENTRY_IN_PROGRESS";
  return (
    <div className="rounded-sm border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
      >
        <span className="font-mono text-sm font-semibold">{order.number}</span>
        <span className="text-sm text-muted-foreground">{day(order.date)}</span>
        {order.customerRef && (
          <span className="text-xs text-muted-foreground">Ihre Ref.: {order.customerRef}</span>
        )}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Badge ok={!inWork} yes="Angelegt" no="In Erfassung" />
          <Badge ok={order.shipped} yes="Geliefert" no="Nicht geliefert" />
          <Badge ok={order.paid} yes="Bezahlt" no="Offen" />
        </span>
        <span className="w-28 text-right font-mono text-sm">{money(order.net, order.currency)}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <DocLink kind="auftragsbestaetigung" id={order.id} label="Auftragsbestätigung" />
            {order.shipped || order.items.some((i) => i.shipped > 0) ? (
              <DocLink kind="lieferschein" id={order.id} label="Lieferschein" />
            ) : null}
            {order.invoices.map((inv) => (
              <DocLink key={inv.id} kind="rechnung" id={inv.id} label={`Rechnung ${inv.number}`} />
            ))}
          </div>
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

      <div className="mt-6 flex gap-2">
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

      {tab === "orders" ? (
        <div className="mt-4 space-y-2">
          {orders.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Aufträge vorhanden.</p>}
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
                  <th className="py-1 text-right">Voraussichtlich</th>
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
                    <td className="py-1.5 text-right">{day(item.plannedDelivery)}</td>
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
