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
  return process.env["APP_PUBLIC_URL"] ?? "https://mawa-shop.lovable.app";
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
  let token: string | null = null;
  try {
    token = await serviceToken();
  } catch {
    const { readToken } = await import("./shop-auth.server");
    token = readToken();
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

/** Alle Artikelbilder des Servicekontos, gruppiert nach Artikel-ID. */
export async function listArticleImages(limit = 500): Promise<Record<string, BackendFile[]>> {
  const res = await fetch(`${apiBase()}/v1/files?limit=${Math.min(Math.max(limit, 1), 500)}`, {
    headers: await authHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`MAWA_API_LIST_FAILED_${res.status}`);

  const parsed = (await res.json()) as unknown;
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

  const grouped: Record<string, BackendFile[]> = {};
  for (const row of rows) {
    const raw = (row ?? {}) as Record<string, unknown>;
    const entity = String(raw["entity"] ?? raw["entity_type"] ?? "");
    if (entity !== ARTICLE_ENTITY) continue;
    const file = mapFile(raw);
    if (!file.id || !file.entityId) continue;
    if (!file.contentType.startsWith("image/")) continue;
    (grouped[file.entityId] ??= []).push(file);
  }
  for (const files of Object.values(grouped)) {
    files.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.filename.localeCompare(b.filename));
  }
  return grouped;
}

/** Bilddaten einer Datei; wird über den öffentlichen Bild-Endpunkt gestreamt. */
export async function fetchFileBytes(
  fileId: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const res = await fetch(
    `${apiBase()}/v1/files/${encodeURIComponent(fileId)}?disposition=inline`,
    { headers: await authHeaders(), signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) return null;
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Datei im Backend löschen. */
export async function deleteFile(fileId: string): Promise<void> {
  await fetch(`${apiBase()}/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: await authHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
}

/** Dateiname ohne Endung, normalisiert — erkennt dasselbe Bild erneut. */
function nameKey(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim().toLowerCase();
}

/** Bild an einen Artikel hängen (entity=article, entity_id=<Artikel-ID>). */
export async function uploadArticleImage(input: {
  articleId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<BackendFile & { replaced: boolean }> {
  // Gleicher Dateiname beim selben Artikel: altes Bild wird ersetzt.
  let replaced = false;
  try {
    const existing = (await listArticleImages())[input.articleId] ?? [];
    const key = nameKey(input.fileName);
    for (const file of existing) {
      if (nameKey(file.filename) !== key) continue;
      await deleteFile(file.id);
      replaced = true;
    }
  } catch {
    /* Ersetzen ist optional — Upload läuft trotzdem weiter. */
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([input.bytes as unknown as BlobPart], { type: input.mimeType || "image/jpeg" }),
    input.fileName,
  );
  form.append("entity", ARTICLE_ENTITY);
  form.append("entity_id", input.articleId);

  const res = await fetch(`${apiBase()}/v1/files`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`MAWA_API_UPLOAD_FAILED_${res.status}: ${detail}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return { ...mapFile(raw), replaced };
}
