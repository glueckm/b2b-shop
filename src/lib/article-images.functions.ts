import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Öffentliche URL eines Artikelbildes (ohne Login nutzbar). */
export const articleImageUrl = (fileId: string) =>
  `/api/public/artikel-bild/${encodeURIComponent(fileId)}`;

/** Bilder je Artikel-ID als öffentliche URLs. Fehler ergeben eine leere Liste. */
export const getArticleImageMap = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ articleIds: z.array(z.string()).max(600) }).parse(raw ?? {}))
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

const uploadInput = z.object({
  articleId: z.string().regex(/^[0-9]{1,20}$/),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(160).default("image/jpeg"),
  /** Bilddaten als Base64, max. ~15 MB Rohdaten. */
  contentBase64: z.string().min(4).max(21_000_000),
});

export const uploadArticleImageFn = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => uploadInput.parse(raw ?? {}))
  .handler(async ({ data }): Promise<{ ok: boolean; url?: string; replaced?: boolean; error?: string }> => {
    try {
      const { uploadArticleImage } = await import("./mawa-api.server");
      const bytes = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0));
      const file = await uploadArticleImage({
        articleId: data.articleId,
        fileName: data.fileName,
        mimeType: data.mimeType,
        bytes,
      });
      return { ok: true, url: articleImageUrl(file.id), replaced: file.replaced };
    } catch (error) {
      const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
      return {
        ok: false,
        error: message.startsWith("MAWA_API_CREDENTIALS_MISSING")
          ? "Zugangsdaten für das MAWA-Backend fehlen noch."
          : message,
      };
    }
  });
