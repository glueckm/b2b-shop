import manifest from "@/data/article-images.json";

const images = manifest as Record<string, string[]>;

/**
 * Bilder eines Artikels: zuerst über die interne Artikel-ID, sonst über die Artikelnummer.
 * Dateien liegen in public/artikel-bilder/, Verzeichnis via scripts/index-article-images.mjs.
 */
export function articleImages(articleId: string, sku: string): string[] {
  return images[articleId] ?? images[sku] ?? [];
}
