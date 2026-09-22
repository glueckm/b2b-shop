import { Client } from "pg";

/**
 * Verbindungsstrategie: kein Pool über Anfragen hinweg (in der kurzlebigen
 * Server-Umgebung wird eine offene Verbindung nie wiederverwendet, aber
 * blockiert das Verbindungslimit). Innerhalb einer Anfrage teilen dagegen
 * alle Abfragen genau eine Verbindung — ein Handshake statt vier.
 *
 * withDbSession() öffnet die Verbindung beim ersten query() und schließt sie,
 * sobald die Anfrage fertig ist.
 */
type DbSession = {
  client?: Client;
  connecting?: Promise<Client>;
  closed: boolean;
  /** Laufende Abfragen – die Verbindung wird erst danach geschlossen. */
  pending: Set<Promise<unknown>>;
};

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

/** Aktive Verbindung der laufenden Anfrage (AsyncLocalStorage, falls verfügbar). */
type Store = { session: DbSession };

const storeRef = globalThis as typeof globalThis & {
  __mawaDbAls?: { getStore(): Store | undefined; run<T>(store: Store, fn: () => T): T } | null;
};

async function getAls() {
  if (storeRef.__mawaDbAls !== undefined) return storeRef.__mawaDbAls;
  try {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    storeRef.__mawaDbAls = new AsyncLocalStorage<Store>();
  } catch {
    storeRef.__mawaDbAls = null;
  }
  return storeRef.__mawaDbAls;
}

async function sessionClient(session: DbSession): Promise<Client> {
  if (session.client) return session.client;
  session.connecting ??= openClient().then((client) => {
    session.client = client;
    return client;
  });
  return session.connecting;
}

/**
 * Führt fn aus und teilt dabei eine einzige Datenbankverbindung zwischen allen
 * darin ausgelösten query()-Aufrufen. Die Verbindung wird danach geschlossen.
 */
export async function withDbSession<T>(fn: () => Promise<T>): Promise<T> {
  const als = await getAls();
  if (!als) return fn();
  const session: DbSession = { closed: false, pending: new Set() };
  try {
    return await als.run({ session }, fn);
  } finally {
    session.closed = true;
    while (session.pending.size) {
      await Promise.allSettled([...session.pending]);
    }
    const client = session.client ?? (await session.connecting?.catch(() => undefined));
    await client?.end().catch(() => undefined);
  }
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const als = await getAls();
  const session = als?.getStore()?.session;

  // Innerhalb einer Anfrage: gemeinsame Verbindung wiederverwenden.
  if (session && !session.closed) {
    const client = await sessionClient(session);
    const task = client.query(sql, params as never[]);
    session.pending.add(task);
    try {
      const result = await task;
      return result.rows as T[];
    } finally {
      session.pending.delete(task);
    }
  }

  // Außerhalb (Hintergrund-Erneuerung o. Ä.): kurzlebige Einzelverbindung.
  const client = await openClient();
  try {
    const result = await client.query(sql, params as never[]);
    return result.rows as T[];
  } finally {
    await client.end().catch(() => undefined);
  }
}
