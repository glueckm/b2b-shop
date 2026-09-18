import { createFileRoute } from "@tanstack/react-router";

/**
 * Öffentlicher Bild-Endpunkt: liest das Bild serverseitig aus dem
 * MAWA-Backend (mit Servicekonto) und liefert es ohne Login aus.
 */
export const Route = createFileRoute("/api/public/artikel-bild/$fileId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const fileId = params.fileId;
        if (!/^[A-Za-z0-9._-]{4,128}$/.test(fileId)) {
          return new Response("Bad request", { status: 400 });
        }
        try {
          const { fetchFileBytes } = await import("@/lib/mawa-api.server");
          const file = await fetchFileBytes(fileId);
          if (!file) return new Response("Not found", { status: 404 });
          return new Response(file.bytes, {
            headers: {
              "content-type": file.contentType,
              "cache-control": "public, max-age=86400",
            },
          });
        } catch {
          return new Response("Bild nicht verfügbar", { status: 502 });
        }
      },
    },
  },
});
