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
  .handler(
    async ({
      data,
    }): Promise<{ images: Record<string, string[]>; thumbs: Record<string, string> }> => {
      const images: Record<string, string[]> = {};
      const thumbs: Record<string, string> = {};
      try {
        const { listArticleImages } = await import("./mawa-api.server");
        // Vorschaubilder (_thumb) werden im CRM erzeugt und hier nur erkannt.
        const isThumb = (name: string) => /_thumb\.[^.]+$/i.test(name);
        const grouped = await listArticleImages(data.articleIds);
        for (const [articleId, files] of Object.entries(grouped)) {
          const full = files.filter((file) => !isThumb(file.filename));
          const thumb = files.find((file) => isThumb(file.filename));
          if (full.length > 0) images[articleId] = full.map((file) => articleImageUrl(file.id));
          if (thumb) thumbs[articleId] = articleImageUrl(thumb.id);
        }
      } catch {
        /* Bilder sind optional */
      }
      return { images, thumbs };
    },
  );
