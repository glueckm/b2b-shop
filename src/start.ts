import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

function isClientAbort(error: unknown): boolean {
  for (let e: unknown = error, i = 0; e && i < 5; i++) {
    const err = e as { name?: string; message?: string; code?: string; cause?: unknown };
    if (err.name === "AbortError" || err.code === "ECONNRESET" || err.message === "aborted") return true;
    e = err.cause;
  }
  return false;
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // Vom Browser abgebrochene Anfragen (Neuladen, Seitenwechsel) sind kein Fehler.
    if (isClientAbort(error)) return new Response(null, { status: 499 });
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
