export type StockState = "in" | "low" | "backorder";

export type Product = {
  sku: string;
  name: string;
  spec: string;
  category: string;
  unitPrice: number;
  caseSize: number;
  moq: number;
  stock: StockState;
  onHand: number;
  breaks: { from: number; price: number }[];
};

export const categories = [
  { name: "All products", count: 1284 },
  { name: "Cleaning", count: 412 },
  { name: "Packaging", count: 268 },
  { name: "Safety & PPE", count: 190 },
  { name: "Kitchen & Prep", count: 200 },
  { name: "Equipment", count: 214 },
];

export const products: Product[] = [
  {
    sku: "MAW-CL-0142",
    name: "Heavy-Duty Surface Cleaner",
    spec: "5 L canister · concentrate 1:40",
    category: "Cleaning",
    unitPrice: 18.4,
    caseSize: 4,
    moq: 2,
    stock: "in",
    onHand: 2340,
    breaks: [
      { from: 2, price: 18.4 },
      { from: 12, price: 17.2 },
      { from: 36, price: 15.9 },
      { from: 96, price: 14.6 },
    ],
  },
  {
    sku: "MAW-CP-0390",
    name: "2-Ply Paper Towels, Jumbo Roll",
    spec: "300 m roll · 6 rolls / case",
    category: "Cleaning",
    unitPrice: 6.2,
    caseSize: 6,
    moq: 4,
    stock: "low",
    onHand: 140,
    breaks: [
      { from: 4, price: 6.2 },
      { from: 24, price: 5.8 },
      { from: 60, price: 5.35 },
      { from: 120, price: 4.95 },
    ],
  },
  {
    sku: "MAW-PE-0771",
    name: "Nitrile Gloves, Powder-Free L",
    spec: "200 pcs box · food-safe",
    category: "Safety & PPE",
    unitPrice: 1.05,
    caseSize: 10,
    moq: 10,
    stock: "in",
    onHand: 18400,
    breaks: [
      { from: 10, price: 1.05 },
      { from: 100, price: 0.97 },
      { from: 500, price: 0.89 },
      { from: 2000, price: 0.81 },
    ],
  },
  {
    sku: "MAW-PK-0512",
    name: "Corrugated Shipping Case",
    spec: "400 × 300 × 200 mm · double wall",
    category: "Packaging",
    unitPrice: 1.36,
    caseSize: 25,
    moq: 25,
    stock: "in",
    onHand: 9600,
    breaks: [
      { from: 25, price: 1.36 },
      { from: 250, price: 1.24 },
      { from: 1000, price: 1.12 },
      { from: 5000, price: 0.98 },
    ],
  },
  {
    sku: "MAW-KT-0528",
    name: "Prep Gloves, Disposable M",
    spec: "100 pcs box · vinyl",
    category: "Kitchen & Prep",
    unitPrice: 0.72,
    caseSize: 10,
    moq: 20,
    stock: "backorder",
    onHand: 0,
    breaks: [
      { from: 20, price: 0.72 },
      { from: 200, price: 0.66 },
      { from: 800, price: 0.6 },
      { from: 2000, price: 0.55 },
    ],
  },
  {
    sku: "MAW-EQ-0633",
    name: "Floor Scrubber, 17 cm Head",
    spec: "single unit · 2 yr trade warranty",
    category: "Equipment",
    unitPrice: 1240,
    caseSize: 1,
    moq: 1,
    stock: "in",
    onHand: 18,
    breaks: [
      { from: 1, price: 1240 },
      { from: 3, price: 1185 },
      { from: 6, price: 1120 },
      { from: 12, price: 1040 },
    ],
  },
];

export const stockLabel: Record<StockState, string> = {
  in: "In stock",
  low: "Low stock",
  backorder: "Backorder",
};

export function priceForQty(product: Product, qty: number) {
  let price = product.breaks[0].price;
  for (const b of product.breaks) if (qty >= b.from) price = b.price;
  return price;
}

export const eur = (value: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
