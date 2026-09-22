import { Pool } from "pg";

const globalRef = globalThis as typeof globalThis & {
  __mawaPgPool?: Pool;
  __mawaPgUrl?: string;
};

export function getPool(): Pool {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  // Wird der Zugang gewechselt, darf kein Pool mit den alten Zugangsdaten weiterlaufen.
  if (globalRef.__mawaPgPool && globalRef.__mawaPgUrl !== connectionString) {
    const stale = globalRef.__mawaPgPool;
    globalRef.__mawaPgPool = undefined;
    void stale.end().catch(() => undefined);
  }
  if (!globalRef.__mawaPgPool) {
    globalRef.__mawaPgUrl = connectionString;
    globalRef.__mawaPgPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 15_000,
      allowExitOnIdle: true,
    });
    globalRef.__mawaPgPool.on("error", () => {
      // swallow idle-client errors so a dropped connection never crashes the server
    });
  }
  return globalRef.__mawaPgPool;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTooManyConnections(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /too many connections|too many clients/i.test(message);
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await getPool().query(sql, params as never[]);
      return result.rows as T[];
    } catch (error) {
      lastError = error;
      if (!isTooManyConnections(error)) throw error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}
