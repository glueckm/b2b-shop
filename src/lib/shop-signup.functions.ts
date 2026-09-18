import { createServerFn } from "@tanstack/react-start";

export type AccessRequestResult =
  | { ok: true; kind: "granted"; status: string; hint: string | null; email: string | null }
  | { ok: true; kind: "review"; message: string }
  | { ok: false; error: string };

/** Zugang zum Shop anfordern – prüft die Berechtigung und schaltet frei oder vermerkt die Anfrage. */
export const requestShopAccess = createServerFn({ method: "POST" })
  .inputValidator((data: { customerNumber: string }) => ({
    customerNumber: String(data?.customerNumber ?? "").trim(),
  }))
  .handler(async ({ data }): Promise<AccessRequestResult> => {
    if (!data.customerNumber) {
      return { ok: false, error: "Bitte Ihre Kundennummer eingeben." };
    }

    const { checkEligibility, apiSignup, apiRecordRegistration } = await import(
      "./shop-signup.server"
    );

    let check;
    try {
      check = await checkEligibility(data.customerNumber);
    } catch {
      return { ok: false, error: "Prüfung derzeit nicht möglich. Bitte später erneut versuchen." };
    }

    if (!check.found) {
      return {
        ok: false,
        error: "Zu dieser Kundennummer finden wir kein Konto. Bitte prüfen Sie die Eingabe.",
      };
    }

    if (check.allowed) {
      try {
        const result = await apiSignup(check.customerNumber);
        // Nur wenn das Backend gar nichts zustellen konnte, geht die Anfrage in die Prüfung.
        const delivered = result.status === "sent" || result.hint !== null;
        if (!delivered) {
          // Backend konnte den Zugang nicht abschließen – Anfrage vermerken.
          try {
            await apiRecordRegistration({
              customerNumber: check.customerNumber,
              email: check.email,
              note: `Freischaltung ohne Versand (Status: ${result.status}) – bitte manuell prüfen.`,
            });
          } catch {
            /* ignore */
          }
          return {
            ok: true,
            kind: "review",
            message:
              "Ihre Anfrage ist eingegangen, der Zugang konnte aber noch nicht automatisch freigeschaltet werden. Unser Team prüft das und meldet sich bei Ihnen.",
          };
        }
        return {
          ok: true,
          kind: "granted",
          status: result.status,
          hint: result.hint,
          email: check.email,
        };
      } catch {
        // Freischaltung nicht möglich – Anfrage trotzdem vermerken.
        try {
          await apiRecordRegistration({
            customerNumber: check.customerNumber,
            email: check.email,
            note: "Automatische Freischaltung fehlgeschlagen – bitte manuell prüfen.",
          });
        } catch {
          /* ignore */
        }
        return {
          ok: true,
          kind: "review",
          message:
            "Ihre Anfrage ist bei uns eingegangen. Wir prüfen sie und melden uns per E-Mail bei Ihnen.",
        };
      }
    }

    const note =
      check.reason === "no_email"
        ? "Keine E-Mail-Adresse beim Kunden hinterlegt."
        : check.reason === "blocked"
          ? "Kunde ist in weclapp gesperrt."
          : `Kundenkategorie ohne Shop-Zugang: ${check.category ?? "unbekannt"}.`;

    try {
      await apiRecordRegistration({
        customerNumber: check.customerNumber,
        email: check.email,
        note,
      });
    } catch {
      /* Anfrage konnte nicht vermerkt werden – Kunde erhält dennoch eine Rückmeldung. */
    }

    return {
      ok: true,
      kind: "review",
      message:
        check.reason === "no_email"
          ? "Für Ihre Kundennummer ist keine E-Mail-Adresse hinterlegt. Wir haben Ihre Anfrage aufgenommen und melden uns bei Ihnen."
          : "Ihre Anfrage wurde aufgenommen. Unser Vertriebsteam prüft Ihren Zugang und meldet sich bei Ihnen.",
    };
  });
