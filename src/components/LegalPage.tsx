import { Link, useRouter } from "@tanstack/react-router";

function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.history.back() : void router.navigate({ to: "/" }))}
      className="rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
    >
      ← Zurück
    </button>
  );
}

export function LegalPage({ title, text }: { title: string; text: string }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <div className="sticky top-0 z-10 -mx-5 bg-background/95 px-5 py-3 backdrop-blur">
        <BackButton />
      </div>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{title}</h1>
      <div className="mt-6 space-y-3 text-[14px] leading-relaxed">
        {lines.map((l, i) =>
          /^\d{1,2} \S/.test(l) && l.length < 90 ? (
            <h2 key={i} className="pt-4 text-lg font-bold">{l}</h2>
          ) : (
            <p key={i}>{l}</p>
          ),
        )}
      </div>
      <div className="mt-10 flex gap-3">
        <BackButton />
        <Link to="/" className="rounded-sm border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">
          Zum Shop
        </Link>
      </div>
    </main>
  );
}
