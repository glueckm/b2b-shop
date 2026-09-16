/**
 * Bilder im Browser verkleinern, bevor sie ins MAWA-Backend hochgeladen werden.
 * Marketingmaterial ist oft mehrere Tausend Pixel breit; für den Shop reicht
 * eine Kante von 1200 px. Transparente PNGs bleiben PNG, alles andere wird
 * als WebP (bzw. JPEG als Rückfall) gespeichert.
 */

export const MAX_EDGE = 1600;

export type ResizedImage = {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  originalBytes: number;
  width: number;
  height: number;
  resized: boolean;
};

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "bild";
}

function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

function canEncode(mime: string): boolean {
  const canvas = document.createElement("canvas");
  return canvas.toDataURL(mime).startsWith(`data:${mime}`);
}

/** Verkleinert das Bild auf max. MAX_EDGE Pixel Kantenlänge. */
export async function resizeForShop(file: File, maxEdge = MAX_EDGE): Promise<ResizedImage> {
  const originalBytes = file.size;

  // SVG und unbekannte Typen unverändert durchlassen.
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return {
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      bytes: await file.arrayBuffer(),
      originalBytes,
      width: 0,
      height: 0,
      resized: false,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return {
      fileName: file.name,
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
      originalBytes,
      width: 0,
      height: 0,
      resized: false,
    };
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const keepPng = file.type === "image/png";
  const targetMime = keepPng ? "image/png" : canEncode("image/webp") ? "image/webp" : "image/jpeg";
  const quality = targetMime === "image/png" ? undefined : 0.82;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return {
      fileName: file.name,
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
      originalBytes,
      width: 0,
      height: 0,
      resized: false,
    };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), targetMime, quality),
  );
  if (!blob) {
    return {
      fileName: file.name,
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
      originalBytes,
      width,
      height,
      resized: false,
    };
  }

  // Wenn die "Optimierung" nichts bringt, Original behalten.
  if (scale === 1 && blob.size >= originalBytes) {
    return {
      fileName: file.name,
      mimeType: file.type,
      bytes: await file.arrayBuffer(),
      originalBytes,
      width,
      height,
      resized: false,
    };
  }

  return {
    fileName: `${baseName(file.name)}.${extensionFor(targetMime)}`,
    mimeType: targetMime,
    bytes: await blob.arrayBuffer(),
    originalBytes,
    width,
    height,
    resized: true,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}
