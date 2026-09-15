// Liest public/artikel-bilder/ und schreibt src/data/article-images.json.
// Dateinamen: <ArtikelID>.jpg, <ArtikelID>-1.jpg, <ArtikelID>_2.png, <Artikelnummer>-3.webp ...
// Aufruf: bun scripts/index-article-images.mjs
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";

const DIR = "public/artikel-bilder";
const OUT = "src/data/article-images.json";
const EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

let files = [];
try {
  files = readdirSync(DIR, { recursive: true }).filter((f) => typeof f === "string" && EXT.test(f));
} catch {
  files = [];
}

const map = {};
for (const file of files.sort((a, b) => a.localeCompare(b, "de", { numeric: true }))) {
  const base = file.split("/").pop().replace(EXT, "");
  const key = base.split(/[-_ ]/)[0].trim();
  if (!key) continue;
  (map[key] ??= []).push(`/artikel-bilder/${file}`);
}

mkdirSync("src/data", { recursive: true });
writeFileSync(OUT, `${JSON.stringify(map, null, 2)}\n`);
console.log(`${Object.keys(map).length} Artikel, ${files.length} Bilder → ${OUT}`);
