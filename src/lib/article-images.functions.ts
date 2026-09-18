import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Öffentliche URL eines Artikelbildes (ohne Login nutzbar). */
export const articleImageUrl = (fileId: string) =>
  `/api/public/artikel-bild/${encodeURIComponent(fileId)}`;

/** Bilder je Artikel-ID als öffentliche URLs. Fehler ergeben eine leere Liste. */
export const getArticleImageMap = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ articleIds: z.array(z.string()).max(600) }).parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<Record<string, string[]>> => {
    try {
      const { listArticleImages } = await import("./mawa-api.server");
      const grouped = await listArticleImages(data.articleIds);
      return Object.fromEntries(
        Object.entries(grouped).map(([articleId, files]) => [
          articleId,
          files.map((file) => articleImageUrl(file.id)),
        ]),
      );
    } catch {
      return {};
    }
  });
