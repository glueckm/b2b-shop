/**
 * Zugriff auf das bestehende MAWA-Backend (mawaapi) — Dateien/Anhänge.
 * Artikelbilder werden dort als Dateien mit entity="article" und
 * entity_id=<weclapp Artikel-ID> abgelegt.
 *
 * Der Shop hat keinen Login: er meldet sich serverseitig mit einem
 * Servicekonto an (MAWA_API_EMAIL / MAWA_API_PASSWORD). Das Token bleibt
 * im Server, der Browser sieht nur /api/public/artikel-bild/<id>.
 */

export const ARTICLE_ENTITY = "article";

export type BackendFile = {
  id: string;
  filename: string;
  contentType: string;
  entityId: string | null;
  createdAt: string | null;
};

function apiBase(): string {
  const configured = process.env["USER_API_BASE_URL"] ?? "";
  // Die alte Adresse mangari.org ist abgeschaltet – immer das Produktiv-Backend nutzen.
  if (!configured || configured.includes("mangari.org")) return "https://mawaapi.mangari.info";
  return configured;
}

function appOrigin(): string {
  return process.env["APP_PUBLIC_URL"] ?? "https://mawashop.lovable.app";
}

let cached: { token: string; expires: number } | null = null;

/** Servicekonto-Token, ~50 Minuten im Speicher gehalten. */
async function serviceToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;

  const email = process.env["MAWA_API_EMAIL"];
  const password = process.env["MAWA_API_PASSWORD"];
  if (!email || !password) throw new Error("MAWA_API_CREDENTIALS_MISSING");

  const res = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: appOrigin() },
    body: new URLSearchParams({ username: email, password }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`MAWA_API_LOGIN_FAILED_${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("MAWA_API_LOGIN_FAILED");

  cached = { token: body.access_token, expires: Date.now() + 50 * 60 * 1000 };
  return cached.token;
}

/**
 * Artikelbilder sind allgemeine Shop-Daten: sie gehören dem Shop-Servicekonto,
 * damit alle Kunden (auch ohne Anmeldung) dieselben Bilder sehen.
 * Nur wenn kein Servicekonto hinterlegt ist, wird ersatzweise das Token des
 * angemeldeten Kunden verwendet.
 */
/** Nur das Servicekonto (für Vorgänge ohne angemeldeten Kunden). */
export async function serviceAuthHeaders(): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await serviceToken()}`, origin: appOrigin() };
}

async function authHeaders(): Promise<Record<string, string>> {
  // Die Shop-Endpunkte akzeptieren nur das Token des angemeldeten Kunden.
  // Das Servicekonto dient lediglich als Rückfalloption.
  let token: string | null = null;
  try {
    const { readToken } = await import("./shop-auth.server");
    token = readToken();
  } catch {
    /* kein Request-Kontext */
  }
  if (!token) {
    try {
      token = await serviceToken();
    } catch {
      token = null;
    }
  }
  if (!token) throw new Error("MAWA_API_CREDENTIALS_MISSING");
  return { authorization: `Bearer ${token}`, origin: appOrigin() };
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function mapFile(raw: Record<string, unknown>): BackendFile {
  return {
    id: String(raw["id"] ?? ""),
    filename: String(raw["filename"] ?? raw["name"] ?? "Bild"),
    contentType: String(raw["contentType"] ?? raw["content_type"] ?? "application/octet-stream"),
    entityId: str(raw["entityId"] ?? raw["entity_id"]),
    createdAt: str(raw["createdAt"] ?? raw["created_at"]),
  };
}

/** Neues Shop-Backend: Bilder werden je Artikel abgefragt. */
function mapShopFile(raw: Record<string, unknown>, articleId: string): BackendFile {
  return {
    id: String(raw["fileId"] ?? raw["id"] ?? ""),
    filename: String(raw["fileName"] ?? raw["filename"] ?? "Bild"),
    contentType: String(raw["contentType"] ?? "application/octet-stream"),
    entityId: articleId,
    createdAt: str(raw["uploadedAt"] ?? raw["createdAt"]),
  };
}

const imageCache = new Map<string, { files: BackendFile[]; expires: number }>();
const CACHE_MS = 60_000;

/** Bilder eines Artikels über GET /v1/shop/articles/{id}/images. */
async function listImagesForArticle(articleId: string): Promise<BackendFile[]> {
  const hit = imageCache.get(articleId);
  if (hit && hit.expires > Date.now()) return hit.files;

  const res = await fetch(
    `${apiBase()}/v1/shop/articles/${encodeURIComponent(articleId)}/images`,
    { headers: await authHeaders(), signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return [];
    if (res.status === 404) {
      imageCache.set(articleId, { files: [], expires: Date.now() + CACHE_MS });
      return [];
    }
    throw new Error(`MAWA_API_LIST_FAILED_${res.status}`);
  }

  const parsed = (await res.json()) as unknown;
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

  const files = rows
    .map((row) => mapShopFile((row ?? {}) as Record<string, unknown>, articleId))
    .filter((file) => file.id !== "")
    .sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.filename.localeCompare(b.filename),
    );

  imageCache.set(articleId, { files, expires: Date.now() + CACHE_MS });
  return files;
}

let bulkAvailable = true;

/** Höchstens so viele Artikel-IDs pro Sammelabfrage (URL-Länge). */
const BULK_CHUNK = 50;

/**
 * Sammelabfrage: GET /v1/shop/articles/images?articleIds=a,b,c
 * Liefert das Backend sie nicht (404/405), wird dauerhaft auf Einzelabfragen
 * umgeschaltet.
 */
async function listImagesBulkChunk(
  ids: string[],
): Promise<Record<string, BackendFile[]> | null> {
  if (!bulkAvailable || ids.length === 0) return null;
  try {
    const res = await fetch(
      `${apiBase()}/v1/shop/articles/images?articleIds=${ids.map(encodeURIComponent).join(",")}`,
      { headers: await authHeaders(), signal: AbortSignal.timeout(20_000) },
    );
    if (res.status === 404 || res.status === 405) {
      bulkAvailable = false;
      return null;
    }
    if (!res.ok) return null;

    const parsed = (await res.json()) as unknown;
    const rows: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];

    const grouped: Record<string, BackendFile[]> = {};
    for (const row of rows) {
      const entry = (row ?? {}) as Record<string, unknown>;
      const articleId = String(entry["articleId"] ?? entry["article_id"] ?? "");
      if (!articleId) continue;
      const listRaw = entry["images"] ?? entry["files"];
      const files = (Array.isArray(listRaw) ? listRaw : [])
        .map((file) => mapShopFile((file ?? {}) as Record<string, unknown>, articleId))
        .filter((file) => file.id !== "")
        .sort(
          (a, b) =>
            (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
            a.filename.localeCompare(b.filename),
        );
      grouped[articleId] = files;
    }
    // Auch leere Ergebnisse merken, damit nicht einzeln nachgefragt wird.
    for (const id of ids) {
      imageCache.set(id, { files: grouped[id] ?? [], expires: Date.now() + CACHE_MS });
    }
    return grouped;
  } catch {
    return null;
  }
}

/** Sammelabfrage in Portionen von BULK_CHUNK IDs; null, wenn nicht verfügbar. */
async function listImagesBulk(ids: string[]): Promise<Record<string, BackendFile[]> | null> {
  if (!bulkAvailable || ids.length === 0) return null;
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += BULK_CHUNK) {
    chunks.push(ids.slice(index, index + BULK_CHUNK));
  }
  const results = await Promise.all(chunks.map((chunk) => listImagesBulkChunk(chunk)));
  if (results.some((result) => result === null)) return null;
  return Object.assign({}, ...(results as Record<string, BackendFile[]>[]));
}

/** Bilder mehrerer Artikel, gruppiert nach Artikel-ID (Sammelabfrage, sonst parallel). */
export async function listArticleImages(
  articleIds: string[] = [],
): Promise<Record<string, BackendFile[]>> {
  const ids = [...new Set(articleIds.filter(Boolean))];
  const grouped: Record<string, BackendFile[]> = {};

  const missing = ids.filter((id) => {
    const hit = imageCache.get(id);
    if (!hit || hit.expires <= Date.now()) return true;
    if (hit.files.length > 0) grouped[id] = hit.files;
    return false;
  });

  const bulk = await listImagesBulk(missing);
  if (bulk) {
    for (const [id, files] of Object.entries(bulk)) if (files.length > 0) grouped[id] = files;
    return grouped;
  }


  const queue = [...missing];


  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      try {
        const files = await listImagesForArticle(id);
        if (files.length > 0) grouped[id] = files;
      } catch {
        /* einzelner Artikel ohne Bilder — Liste bleibt nutzbar */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return grouped;
}

/** Bilddaten einer Datei; wird über den öffentlichen Bild-Endpunkt gestreamt. */
export async function fetchFileBytes(
  fileId: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const res = await fetch(`${apiBase()}/v1/shop/images/${encodeURIComponent(fileId)}`, {
    headers: await authHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
