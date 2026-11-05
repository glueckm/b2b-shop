import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./catalog.functions.ts", import.meta.url), "utf8");

describe.skipIf(!process.env["DATABASE_URL"])("shop stock scope", () => {
  it("counts only the main storage place in article stock, EOL checks and statistics", async () => {
    const predicates = [...source.matchAll(/(?:w\.)?warehouse_id = '3566'[^\n)]*/g)]
      .map(([predicate]) => (predicate.split("--")[0] ?? "").replaceAll("w.", "").trim());
    expect(predicates).toHaveLength(3);
    const client = new Client({
      connectionString: process.env["DATABASE_URL"],
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      for (const predicate of predicates) {
        const result = await client.query(`
          select coalesce(sum(quantity), 0)::int as on_hand
          from (values
            ('3566', '3568', 19),
            ('3566', '1971039', 2),
            ('105915', '764392', 9),
            ('105915', '3568', 4)
          ) as stock(warehouse_id, storage_place_id, quantity)
          where ${predicate}
        `);
        expect(result.rows[0]?.on_hand).toBe(19);
      }
    } finally {
      await client.end();
    }
  });
});
describe.skipIf(!process.env["DATABASE_URL"])("reserved quantity", () => {
  it("subtracts unshipped quantities of open main-warehouse orders only", async () => {
    const { RESERVED_QTY } = await import("./catalog.functions");
    const client = new Client({
      connectionString: process.env["DATABASE_URL"],
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
    });
    try {
      await client.connect();
      await client.query("BEGIN");
      await client.query(`
        create temp table sales_order (id text, warehouse_id text, status text) on commit drop;
        create temp table sales_order_item (sales_order_id text, article_id text, quantity int, shipped_quantity int) on commit drop;
        insert into sales_order values
          ('o1', '3566', 'ORDER_CONFIRMATION_PRINTED'), ('o2', '3566', 'ORDER_CONFIRMATION_PRINTED'),
          ('o3', '3566', 'CLOSED'), ('o4', '3566', 'CANCELLED'), ('o5', '3566', 'MANUALLY_CLOSED'),
          ('o6', '105915', 'ORDER_CONFIRMATION_PRINTED'), ('o7', '3566', 'ORDER_CONFIRMATION_PRINTED');
        insert into sales_order_item values
          ('o1', 'A', 1, 0), ('o2', 'A', 1, 0), ('o3', 'A', 5, 0), ('o4', 'A', 5, 0),
          ('o5', 'A', 5, 0), ('o6', 'A', 5, 0), ('o7', 'A', 3, 3);
      `);
      const expr = RESERVED_QTY("'A'").replaceAll("weclapp.", "pg_temp.");
      const r = await client.query(`select (19 - ${expr})::int as available`);
      expect(r.rows[0]?.available).toBe(17);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end();
    }
  });
});
