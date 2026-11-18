import { articleImageSku } from "./article-image-source";
import { withDbSession } from "./db.server";
import { listArticleImages, type BackendFile } from "./mawa-api.server";

/** Die Bildquelle ist unabhängig davon, ob der normale Artikel im aktuellen Katalog steht. */
export async function listShopArticleImages(
  articleIds: string[],
): Promise<Record<string, BackendFile[]>> {
  const ids = [...new Set(articleIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const sources = new Map(ids.map((id) => [id, id]));
  await withDbSession(async ({ query }) => {
    const marked = await query<{ id: string; sku: string }>(
      `select id::text as id, article_number as sku from weclapp.article
       where id::text = any($1::text[])
         and article_number ~* '^\\s*(BW|SA)\\s*-\\s*'`,
      [ids],
    );
    if (marked.length === 0) return;
    const originals = await query<{ id: string; sku: string }>(
      `select id::text as id, article_number as sku from weclapp.article
       where article_number = any($1::text[]) order by id`,
      [[...new Set(marked.map((article) => articleImageSku(article.sku)))]],
    );
    for (const article of marked) {
      const original = originals.find((row) => row.sku === articleImageSku(article.sku));
      if (original) sources.set(article.id, original.id);
    }
  });
  const files = await listArticleImages([...new Set(sources.values())]);
  const grouped: Record<string, BackendFile[]> = {};
  for (const [id, sourceId] of sources) {
    if (files[sourceId]?.length) grouped[id] = files[sourceId];
  }
  return grouped;
}