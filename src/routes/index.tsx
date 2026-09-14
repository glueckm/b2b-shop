import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import heroImage from "@/assets/warehouse-hero.jpg";
import {
  categories,
  eur,
  priceForQty,
  products,
  stockLabel,
  type Product,
} from "@/data/catalog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MAWA B2B Shop — Wholesale Catalog & Trade Pricing" },
      {
        name: "description",
        content:
          "Order MAWA cleaning, packaging, safety and kitchen supplies at net trade prices with case quantities and volume price breaks.",
      },
      { property: "og:title", content: "MAWA B2B Shop — Wholesale Catalog" },
      {
        property: "og:description",
        content: "Net trade pricing, case quantities and volume breaks for MAWA trade accounts.",
      },
    ],
  }),
  component: Shop,
});

type Line = { sku: string; qty: number };

const stockTone: Record<Product["stock"], string> = {
  in: "text-stock",
  low: "text-low",
  backorder: "text-muted-foreground",
};

const stockDot: Record<Product["stock"], string> = {
  in: "bg-stock",
  low: "bg-low",
  backorder: "bg-muted-foreground",
};

function Shop() {
  const [activeCategory, setActiveCategory] = useState("All products");
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(products.map((p) => [p.sku, p.moq])),
  );
  const [lines, setLines] = useState<Line[]>([
    { sku: "MAW-CL-0142", qty: 12 },
    { sku: "MAW-PE-0771", qty: 100 },
  ]);
  const [quick, setQuick] = useState("");
  const [detailSku, setDetailSku] = useState(products[0]!.sku);

  const visible = useMemo(
    () =>
      activeCategory === "All products"
        ? products
        : products.filter((p) => p.category === activeCategory),
    [activeCategory],
  );

  const detail = products.find((p) => p.sku === detailSku) ?? products[0]!;

  const step = (sku: string, delta: number) =>
    setQty((prev) => {
      const product = products.find((p) => p.sku === sku)!;
      const next = Math.max(product.moq, (prev[sku] ?? product.moq) + delta * product.moq);
      return { ...prev, [sku]: next };
    });

  const addLine = (sku: string, amount: number) =>
    setLines((prev) => {
      const existing = prev.find((l) => l.sku === sku);
      if (existing) return prev.map((l) => (l.sku === sku ? { ...l, qty: l.qty + amount } : l));
      return [...prev, { sku, qty: amount }];
    });

  const removeLine = (sku: string) => setLines((prev) => prev.filter((l) => l.sku !== sku));

  const submitQuick = (event: React.FormEvent) => {
    event.preventDefault();
    const [rawSku, rawQty] = quick.split(/[\s,]+/);
    const product = products.find(
      (p) => p.sku.toLowerCase() === (rawSku ?? "").trim().toLowerCase(),
    );
    if (!product) return;
    addLine(product.sku, Math.max(product.moq, Number(rawQty) || product.moq));
    setQuick("");
  };

  const detailedLines = lines.map((line) => {
    const product = products.find((p) => p.sku === line.sku)!;
    const unit = priceForQty(product, line.qty);
    return { ...line, product, unit, total: unit * line.qty };
  });

  const subtotal = detailedLines.reduce((sum, l) => sum + l.total, 0);
  const listTotal = detailedLines.reduce((sum, l) => sum + l.product.unitPrice * l.qty, 0);
  const savings = listTotal - subtotal;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-sm bg-accent font-mono text-sm font-semibold text-accent-foreground">
              M
            </span>
            <span className="leading-none">
              <span className="block text-base font-bold uppercase tracking-[0.2em]">MAWA</span>
              <span className="label-mono mt-1 block text-primary-foreground/55">
                Trade &amp; Wholesale
              </span>
            </span>
          </div>
          <nav className="ml-4 hidden items-center gap-6 text-sm font-medium lg:flex">
            <a className="text-primary-foreground" href="#catalog">
              Catalog
            </a>
            <a className="text-primary-foreground/65 hover:text-primary-foreground" href="#detail">
              Price breaks
            </a>
            <a className="text-primary-foreground/65 hover:text-primary-foreground" href="#order">
              Order rail
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-5">
            <span className="hidden text-right sm:block">
              <span className="block text-xs font-medium">Nordwerk GmbH</span>
              <span className="label-mono text-primary-foreground/50">Net 30 · Tier 2</span>
            </span>
            <a
              href="#order"
              className="flex items-center gap-2 rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground"
            >
              Order rail
              <span className="font-mono text-xs">{lines.length}</span>
            </a>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden border-b border-border">
        <img
          src={heroImage}
          alt="MAWA distribution warehouse with palletised stock"
          width={1600}
          height={912}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-primary/80" />
        <div className="relative mx-auto max-w-[1440px] px-5 py-14">
          <p className="label-mono text-accent">Trade portal · net pricing</p>
          <h1 className="mt-3 max-w-[26ch] text-4xl font-bold leading-[1.05] tracking-tight text-primary-foreground text-balance">
            Order MAWA stock by the case, at your contract price.
          </h1>
          <dl className="mt-8 flex flex-wrap gap-x-12 gap-y-4 font-mono text-primary-foreground">
            <div>
              <dt className="label-mono text-primary-foreground/55">SKUs live</dt>
              <dd className="text-xl font-semibold">1,284</dd>
            </div>
            <div>
              <dt className="label-mono text-primary-foreground/55">Cut-off</dt>
              <dd className="text-xl font-semibold">16:00 CET</dd>
            </div>
            <div>
              <dt className="label-mono text-primary-foreground/55">Delivery</dt>
              <dd className="text-xl font-semibold">24–48 h</dd>
            </div>
          </dl>
        </div>
      </section>

      <nav className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-5">
          {categories.map((category) => {
            const active = category.name === activeCategory;
            return (
              <button
                key={category.name}
                onClick={() => setActiveCategory(category.name)}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-[13px] transition-colors ${
                  active
                    ? "border-accent font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {category.name}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {category.count}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-7 lg:grid-cols-[minmax(0,1fr)_330px]">
        <main className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="catalog" className="text-2xl font-semibold tracking-tight">
                {activeCategory}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {visible.length} items shown · prices net of VAT · case quantities apply
              </p>
            </div>
            <span className="label-mono text-muted-foreground">Stock updated 06:40</span>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/60">
                  {["SKU", "Product", "Unit net", "Case", "MOQ", "Stock", "Quantity", ""].map(
                    (heading) => (
                      <th key={heading} className="label-mono px-3 py-2.5 font-medium text-muted-foreground">
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="text-sm">
                {visible.map((product) => {
                  const q = qty[product.sku] ?? product.moq;
                  const unit = priceForQty(product, q);
                  const disabled = product.stock === "backorder";
                  return (
                    <tr key={product.sku} className="border-b border-border/70 last:border-0">
                      <td className="px-3 py-3 align-top">
                        <button
                          onClick={() => setDetailSku(product.sku)}
                          className="font-mono text-[12px] text-muted-foreground hover:text-accent"
                        >
                          {product.sku}
                        </button>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="block font-semibold">{product.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {product.spec}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-[13px] font-semibold">
                        {eur(unit)}
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-[12px] text-muted-foreground">
                        {product.caseSize} / case
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-[12px] text-muted-foreground">
                        {product.moq}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span
                          className={`flex items-center gap-1.5 text-xs font-medium ${stockTone[product.stock]}`}
                        >
                          <span className={`size-1.5 rounded-full ${stockDot[product.stock]}`} />
                          {stockLabel[product.stock]}
                          {product.onHand > 0 && (
                            <span className="font-mono text-muted-foreground">
                              {product.onHand.toLocaleString("de-DE")}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="flex w-max items-center rounded-sm border border-border">
                          <button
                            onClick={() => step(product.sku, -1)}
                            aria-label={`Decrease ${product.sku}`}
                            className="grid size-8 place-items-center font-mono text-muted-foreground hover:text-foreground"
                          >
                            −
                          </button>
                          <span className="w-12 text-center font-mono text-[13px]">{q}</span>
                          <button
                            onClick={() => step(product.sku, 1)}
                            aria-label={`Increase ${product.sku}`}
                            className="grid size-8 place-items-center font-mono text-muted-foreground hover:text-foreground"
                          >
                            +
                          </button>
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <button
                          disabled={disabled}
                          onClick={() => addLine(product.sku, q)}
                          className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                        >
                          {disabled ? "Unavailable" : "Add"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section id="detail" className="mt-7 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="label-mono text-muted-foreground">Volume price breaks</p>
                <h3 className="mt-1 text-xl font-semibold tracking-tight">
                  {detail.name} · {detail.sku}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{detail.spec}</p>
              </div>
              <span
                className={`flex items-center gap-1.5 text-sm font-medium ${stockTone[detail.stock]}`}
              >
                <span className={`size-2 rounded-full ${stockDot[detail.stock]}`} />
                {stockLabel[detail.stock]}
              </span>
            </div>

            <table className="mt-4 w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="label-mono py-2 font-medium text-muted-foreground">Quantity from</th>
                  <th className="label-mono py-2 text-right font-medium text-muted-foreground">
                    Unit net
                  </th>
                  <th className="label-mono py-2 text-right font-medium text-muted-foreground">
                    Line at tier
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {detail.breaks.map((tier, index) => {
                  const best = index === detail.breaks.length - 1;
                  return (
                    <tr key={tier.from} className="border-b border-border/70 last:border-0">
                      <td className="py-2.5">{tier.from} units</td>
                      <td
                        className={`py-2.5 text-right ${best ? "font-semibold text-stock" : ""}`}
                      >
                        {eur(tier.price)}
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">
                        {eur(tier.price * tier.from)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </main>

        <aside id="order" className="lg:sticky lg:top-5 lg:self-start">
          <div className="rounded-lg border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="label-mono text-muted-foreground">Order rail</span>
              <span className="font-mono text-[11px] text-accent">{lines.length} lines</span>
            </div>

            <form onSubmit={submitQuick} className="border-b border-border px-4 py-3">
              <label className="block text-xs font-medium text-muted-foreground" htmlFor="quick">
                Quick order — SKU + quantity
              </label>
              <div className="mt-1.5 flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2">
                <input
                  id="quick"
                  value={quick}
                  onChange={(event) => setQuick(event.target.value)}
                  placeholder="MAW-PK-0512 250"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground"
                />
                <button type="submit" className="text-sm font-semibold text-accent">
                  Add
                </button>
              </div>
            </form>

            <ul>
              {detailedLines.length === 0 && (
                <li className="px-4 py-6 text-sm text-muted-foreground">
                  No lines yet. Add products from the catalog.
                </li>
              )}
              {detailedLines.map((line) => (
                <li
                  key={line.sku}
                  className="flex items-start gap-3 border-b border-border/70 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {line.sku}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {line.qty} × {eur(line.unit)}
                      </span>
                    </div>
                    <p className="truncate text-[13px] font-medium">{line.product.name}</p>
                    <p className="mt-0.5 font-mono text-[13px] font-semibold text-accent">
                      {eur(line.total)}
                    </p>
                  </div>
                  <button
                    onClick={() => removeLine(line.sku)}
                    aria-label={`Remove ${line.sku}`}
                    className="font-mono text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="px-4 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal (net)</span>
                <span className="font-mono font-semibold">{eur(subtotal)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Volume saving</span>
                <span className="font-mono font-semibold text-stock">−{eur(savings)}</span>
              </div>
              <button className="mt-4 w-full rounded-sm bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground">
                Submit trade order
              </button>
              <button className="mt-2 w-full rounded-sm border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted">
                Request quote instead
              </button>
              <p className="label-mono mt-3 text-muted-foreground">
                Net 30 · freight free above €750
              </p>
            </div>
          </div>
        </aside>
      </div>

      <footer className="border-t border-border bg-panel">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
          <span>MAWA Wholesale · trade accounts only</span>
          <span className="font-mono text-[12px]">Support +49 30 000 000 · orders@mawa.example</span>
        </div>
      </footer>
    </div>
  );
}
