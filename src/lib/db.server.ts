import { Client } from "pg";

/**
 * Verbindungsstrategie: kein Pool über Anfragen hinweg (in der kurzlebigen
 * Server-Umgebung wird eine offene Verbindung nie wiederverwendet, blockiert
 * aber das Verbindungslimit). Innerhalb einer Anfrage teilen dagegen alle
 * Abfragen genau eine Verbindung — ein Handshake statt vier.
 *
 * Die Session stellt eine an genau diesen Client gebundene query-Funktion
 * bereit. Damit kann kein Laufzeit-Kontext und kein getrennt gebündeltes Modul
 * unbemerkt auf eine zweite Verbindung ausweichen.
 */
export type DbQuery = <T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export type DbSession = { query: DbQuery };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTooManyConnections(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /too many connections|too many clients/i.test(message);
}

function connectionString(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not configured");
  return url;
}

async function openClient(): Promise<Client> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const client = new Client({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      if (!isTooManyConnections(error)) throw error;
      await sleep(200 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Öffnet genau eine Verbindung, bindet alle Abfragen direkt an diesen Client
 * und schließt ihn unmittelbar nach der vollständigen Antwort.
 */
export async function withDbSession<T>(fn: (session: DbSession) => Promise<T>): Promise<T> {
  let clientPromise: Promise<Client> | undefined;
  const session: DbSession = {
    query: async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      clientPromise ??= openClient();
      const client = await clientPromise;
      const result = await client.query(sql, params as never[]);
      return result.rows as R[];
    },
  };
  try {
    return await fn(session);
  } finally {
    const client = await clientPromise?.catch(() => undefined);
    await client?.end().catch(() => undefined);
  }
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  // Bewusst unabhängige Aufgabe außerhalb eines Katalogaufrufs.
  const client = await openClient();
  try {
    const result = await client.query(sql, params as never[]);
    return result.rows as T[];
  } finally {
    await client.end().catch(() => undefined);
  }
}
