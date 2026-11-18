/** Markierte Geräte verwenden die Fotos ihrer normalen Artikelnummer. */
export function articleImageSku(sku: string): string {
  return sku.trim().replace(/^(?:BW|SA)\s*-\s*/i, "").trim();
}