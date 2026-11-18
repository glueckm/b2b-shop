import manifest from "@/data/article-images.json";
import { articleImageSku } from "./article-image-source";

const images = manifest as Record<string, string[]>;

/**
 * Bilder eines Artikels: zuerst über die interne Artikel-ID, sonst über die Artikelnummer.
 * Dateien liegen in public/artikel-bilder/, Verzeichnis via scripts/index-article-images.mjs.
 */
export function articleImages(articleId: string, sku: string): string[] {
  const sourceSku = articleImageSku(sku);
  return (sourceSku !== sku ? images[sourceSku] : undefined) ?? images[articleId] ?? images[sku] ?? [];
}
