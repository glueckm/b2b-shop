import { Client } from "pg";

// Ein Pool ist in der kurzlebigen Server-Umgebung kontraproduktiv: seine
// Verbindung wird nach der Anfrage nicht wiederverwendet, aber bis zum
// idleTimeout gehalten. Abfragen werden deshalb über genau eine kurzlebige
// Verbindung ausgeführt und diese wird unmittelbar danach geschlossen.
let queryQueue: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTooManyConnections(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /too many connections|too many clients/i.test(message);
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const previous = queryQueue;
  let release = () => {};
  queryQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) throw new Error("DATABASE_URL is not configured");

    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15_000,
      });
      try {
        await client.connect();
        const result = await client.query(sql, params as never[]);
        return result.rows as T[];
      } catch (error) {
        lastError = error;
        if (!isTooManyConnections(error)) throw error;
        await sleep(200 * (attempt + 1));
      } finally {
        await client.end().catch(() => undefined);
      }
    }
    throw lastError;
  } finally {
    release();
  }
}
