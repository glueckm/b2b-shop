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