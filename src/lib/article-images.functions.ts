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

/**
 * Lädt eine einzelne Bilddatei über die angemeldete Server-Verbindung.
 * Dadurch funktioniert die Anzeige auch in eingebetteten Vorschauen, in denen
 * der Browser das Shop-Cookie bei einem normalen <img>-Abruf blockiert.
 */
export const getArticleImageData = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ fileId: z.string().regex(/^[A-Za-z0-9._-]{4,128}$/) }).parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<{ dataUrl: string } | null> => {
    try {
      const { fetchFileBytes } = await import("./mawa-api.server");
      const file = await fetchFileBytes(data.fileId);
      if (!file) return null;
      const { Buffer } = await import("node:buffer");
      const encoded = Buffer.from(file.bytes).toString("base64");
      return { dataUrl: `data:${file.contentType};base64,${encoded}` };
    } catch {
      return null;
    }
  });
