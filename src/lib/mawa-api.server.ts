/**
 * Zugriff auf das bestehende MAWA-Backend (mawaapi) — Dateien/Anhänge.
 * Artikelbilder werden dort als Dateien mit entity="article" und
 * entity_id=<weclapp Artikel-ID> abgelegt.
 *
 * Bilder kommen über die öffentliche Schnittstelle (/v1/public/…) ohne Anmeldung.
 */

export const ARTICLE_ENTITY = "article";

export type BackendFile = {
  id: string;
  filename: string;
  contentType: string;
  entityId: string | null;
  createdAt: string | null;
  /** Optional: Bilddaten direkt aus der Sammelabfrage (data:-URL). */
  dataUrl?: string;
  /** Vom Backend als Vorschaubild gekennzeichnet. */
  isThumbnail?: boolean;
};

function apiBase(): string {
  const configured = process.env["USER_API_BASE_URL"] ?? "";
  if (!configured) throw new Error("USER_API_BASE_URL ist nicht gesetzt");
  return configured;
}

function appOrigin(): string {
  return process.env["APP_PUBLIC_URL"] ?? "https://mawashop.lovable.app";
}

function publicHeaders(): Record<string, string> {
  return { origin: appOrigin() };
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
  const inline = str(
    raw["dataUri"] ??
      raw["data_uri"] ??
      raw["dataUrl"] ??
      raw["data"] ??
      raw["dataBase64"] ??
      raw["contentBase64"] ??
      raw["bytesBase64"],
  );
  const inlineContentType = inline?.match(/^data:([^;,]+)/i)?.[1];
  const contentType = String(
    raw["contentType"] ?? raw["content_type"] ?? inlineContentType ?? "application/octet-stream",
  );
  // Schickt das Backend die Bilddaten (Vorschaubild) mit, wird kein
  // zusätzlicher Abruf je Bild mehr nötig.
  const dataUrl = inline
    ? inline.startsWith("data:")
      ? inline
      : `data:${contentType};base64,${inline}`
    : undefined;
  return {
    id: String(raw["fileId"] ?? raw["id"] ?? ""),
    filename: String(raw["fileName"] ?? raw["filename"] ?? "Bild"),
    contentType,
    entityId: articleId,
    createdAt: str(raw["uploadedAt"] ?? raw["createdAt"]),
    ...(dataUrl ? { dataUrl } : {}),
    ...(raw["isThumbnail"] === true || raw["is_thumbnail"] === true
      ? { isThumbnail: true }
      : {}),
  };
}

const imageCache = new Map<string, { files: BackendFile[]; expires: number }>();
const CACHE_MS = 60_000;

/** Bilder eines Artikels über GET /v1/public/articles/{id}/images. */
async function listImagesForArticle(articleId: string): Promise<BackendFile[]> {
  const hit = imageCache.get(articleId);
  if (hit && hit.expires > Date.now()) return hit.files;

  const res = await fetch(
    `${apiBase()}/v1/public/articles/${encodeURIComponent(articleId)}/images`,
    { headers: publicHeaders(), signal: AbortSignal.timeout(15_000) },
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
const BULK_CHUNK = 15;

/**
 * Sammelabfrage: GET /v1/public/articles/images?articleIds=a,b,c&thumbnail=true
 * Mit thumbnail=true (bzw. thumbnails=true) liefert das Backend die
 * Vorschaubilder als dataUri mit.
 * Liefert das Backend die Abfrage nicht (404/405), wird dauerhaft auf
 * Einzelabfragen umgeschaltet.
 */
async function listImagesBulkChunk(
  ids: string[],
): Promise<Record<string, BackendFile[]> | null> {
  if (!bulkAvailable || ids.length === 0) return null;
  try {
    const res = await fetch(
      `${apiBase()}/v1/public/articles/images?articleIds=${ids.map(encodeURIComponent).join(",")}&thumbnails=true`,
      { headers: publicHeaders(), signal: AbortSignal.timeout(20_000) },
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
      // Das Backend kann entweder je Artikel eine `images`-Liste oder flache
      // Bildzeilen mit `articleId` liefern. Beide Formen werden unterstützt.
      const fileRows = Array.isArray(listRaw) ? listRaw : [entry];
      const files = fileRows
        .map((file) => mapShopFile((file ?? {}) as Record<string, unknown>, articleId))
        .filter((file) => file.id !== "")
        .sort(
          (a, b) =>
            (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
            a.filename.localeCompare(b.filename),
        );
      grouped[articleId] = [...(grouped[articleId] ?? []), ...files];
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
        let files: BackendFile[];
        try {
          files = await listImagesForArticle(id);
        } catch {
          // Einzelne Zeitüberschreitungen dürfen kein dauerhaft leeres Vorschaubild erzeugen.
          await new Promise((resolve) => setTimeout(resolve, 250));
          files = await listImagesForArticle(id);
        }
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
  const res = await fetch(`${apiBase()}/v1/public/images/${encodeURIComponent(fileId)}`, {
    headers: publicHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
