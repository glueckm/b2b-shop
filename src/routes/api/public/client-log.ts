import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Fehlerberichte aus dem Browser (z. B. „Katalog nicht erreichbar"), damit
 * Ausfälle, die nie beim Server ankommen, trotzdem im Server-Protokoll stehen.
 * Nur kurze, geprüfte Textfelder; es wird nichts gespeichert oder zurückgegeben.
 */
const schema = z.object({
  ref: z.string().max(40),
  event: z.string().max(60),
  message: z.string().max(500).optional(),
  name: z.string().max(80).optional(),
  stack: z.string().max(1500).optional(),
  url: z.string().max(500).optional(),
  online: z.boolean().optional(),
  version: z.string().max(40).optional(),
});

export const Route = createFileRoute("/api/public/client-log")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const text = await request.text();
        if (text.length > 4000) return new Response(null, { status: 413 });
        let parsed;
        try {
          parsed = schema.parse(JSON.parse(text));
        } catch {
          return new Response(null, { status: 400 });
        }
        const { logEvent } = await import("@/lib/db.server");
        logEvent("error", `client.${parsed.event}`, {
          ...parsed,
          event: `client.${parsed.event}`,
          userAgent: request.headers.get("user-agent")?.slice(0, 200),
        });
        return new Response(null, { status: 204 });
      },
    },
  },
});
