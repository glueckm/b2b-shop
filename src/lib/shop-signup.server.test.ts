import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./shop-signup.server.ts", import.meta.url), "utf8");
const customerSql = source.match(/const CUSTOMER_SQL = `([\s\S]*?)`;/)?.[1];

describe.skipIf(!process.env["DATABASE_URL"])("signup email selection", () => {
  it.each([
    ["missing email list", null, "ballisticworld24@gmx.com", "ballisticworld24@gmx.com"],
    ["empty email list", "", "ballisticworld24@gmx.com", "ballisticworld24@gmx.com"],
    ["whitespace email list", "   ", "  ballisticworld24@gmx.com  ", "ballisticworld24@gmx.com"],
    ["existing list takes priority", " list@example.com ", "customer@example.com", "list@example.com"],
    ["both addresses missing", null, null, null],
    ["both addresses blank", "  ", "  ", null],
  ])("%s", async (_label, listEmail, customerEmail, expectedEmail) => {
    if (!customerSql) throw new Error("Customer SQL not found");
    const client = new Client({
      connectionString: process.env["DATABASE_URL"],
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      const sql = customerSql
        .replace("weclapp.customer c", `(select '3554080'::text as id, 'KN - DE0430'::text as customer_number,
          null::text as old_customer_number, 'Ballistic World 24'::text as company,
          null::text as first_name, null::text as last_name, 'SILBER'::text as customer_category_name,
          $3::text as email, false as blocked) c`)
        .replace("weclapp.party_email_address pe", `(select '3554080'::text as party_id,
          0 as _idx, $2::text as to_addresses where $2::text is not null) pe`);
      const result = await client.query(sql, ["DE0430", listEmail, customerEmail]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.email).toBe(expectedEmail);
    } finally {
      await client.end();
    }
  });
});