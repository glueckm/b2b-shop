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

/** Einzeilige, durchsuchbare Protokollzeile (JSON) – ohne Zugangsdaten. */
export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {},
  error?: unknown,
): void {
  const e = error as
    | { name?: string; message?: string; code?: string; stack?: string; cause?: { message?: string } }
    | undefined;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...details,
    ...(e
      ? {
          errorName: e.name,
          errorMessage: e.message,
          errorCode: e.code,
          errorCause: e.cause?.message,
          stack: e.stack?.split("\n").slice(0, 6).join(" | "),
        }
      : {}),
  });
  // Direkt über die Originalausgabe, damit kein Filter die Zeile verschluckt.
  (level === "error" ? console.warn : level === "warn" ? console.warn : console.log)(`[mawa] ${line}`);
}

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
  const started = Date.now();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const client = new Client({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
    });
    // Ohne Listener würde ein Verbindungsabbruch unbemerkt bleiben.
    client.on("error", (error) => logEvent("error", "db.client_error", {}, error));
    try {
      await client.connect();
      const ms = Date.now() - started;
      if (attempt > 0 || ms > 3_000) logEvent("warn", "db.connect_slow", { ms, attempts: attempt + 1 });
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      logEvent("warn", "db.connect_failed", { attempt: attempt + 1, ms: Date.now() - started }, error);
      if (!isTooManyConnections(error)) throw error;
      await sleep(200 * (attempt + 1));
    }
  }
  logEvent("error", "db.connect_gave_up", { ms: Date.now() - started }, lastError);
  throw lastError;
}

async function runQuery(client: Client, sql: string, params: unknown[]) {
  const started = Date.now();
  try {
    const result = await client.query(sql, params as never[]);
    const ms = Date.now() - started;
    if (ms > 5_000) logEvent("warn", "db.query_slow", { ms, rows: result.rowCount, sql: sql.slice(0, 160) });
    return result;
  } catch (error) {
    logEvent("error", "db.query_failed", { ms: Date.now() - started, sql: sql.slice(0, 160) }, error);
    throw error;
  }
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
      const result = await runQuery(client, sql, params);
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
    const result = await runQuery(client, sql, params);
    return result.rows as T[];
  } finally {
    await client.end().catch(() => undefined);
  }
}
