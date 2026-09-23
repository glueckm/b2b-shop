/**
 * Neukunden-Anfrage ("Kundenlogin anfordern") — Validierung und Versand.
 *
 * Die Felder entsprechen jenen, die in weclapp bei Kunden üblicherweise
 * gepflegt sind (Firma, E-Mail, Telefon, UID, Straße, PLZ, Ort, Land).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const MAWA_LEAD_RECIPIENT = "office@mawa-trading.com";

const text = (max: number) => z.string().trim().min(1).max(max);

export const leadSchema = z.object({
  company: text(120),
  firstName: text(60),
  lastName: text(60),
  email: z.string().trim().email().max(180),
  phone: text(40),
  website: z.string().trim().max(180).optional().or(z.literal("")),
  vatId: text(30),
  street: text(120),
  zipcode: text(20),
  city: text(80),
  country: text(60),
  businessType: text(80),
  message: z.string().trim().max(1500).optional().or(z.literal("")),
});

export type LeadInput = z.infer<typeof leadSchema>;

export type LeadResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

const LINES: [keyof LeadInput, string][] = [
  ["company", "Firma"],
  ["vatId", "UID-Nummer"],
  ["businessType", "Art des Geschäfts"],
  ["street", "Straße"],
  ["zipcode", "PLZ"],
  ["city", "Ort"],
  ["country", "Land"],
  ["website", "Website"],
  ["firstName", "Vorname"],
  ["lastName", "Nachname"],
  ["email", "E-Mail"],
  ["phone", "Telefon"],
  ["message", "Nachricht"],
];

function plainText(data: LeadInput): string {
  return LINES.filter(([key]) => (data[key] ?? "") !== "")
    .map(([key, label]) => `${label}: ${data[key]}`)
    .join("\n");
}

export const submitCustomerLead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => leadSchema.parse(input))
  .handler(async ({ data }): Promise<LeadResult> => {
    const { sendMail } = await import("./mail.server");
    const body = plainText(data);

    const internal = await sendMail({
      to: MAWA_LEAD_RECIPIENT,
      replyTo: data.email,
      subject: `Neue Händleranfrage: ${data.company}`,
      text: `Neue Anfrage für ein MAWA-Händlerkonto:\n\n${body}\n`,
    });

    if (!internal.ok) {
      console.error("[lead] Versand fehlgeschlagen", internal.error, {
        company: data.company,
        email: data.email,
      });
      return {
        ok: false,
        message:
          "Die Anfrage konnte gerade nicht versendet werden. Bitte wenden Sie sich direkt an office@mawa-trading.com.",
      };
    }

    // Bestätigung an den Kunden — ein Fehler hier darf die Anfrage nicht entwerten.
    await sendMail({
      to: data.email,
      subject: "Ihre Anfrage für ein MAWA-Händlerkonto",
      text:
        `Guten Tag ${data.firstName} ${data.lastName},\n\n` +
        "vielen Dank für Ihre Anfrage. Wir prüfen Ihre Angaben und melden uns mit den nächsten Schritten.\n\n" +
        `Ihre Angaben:\n${body}\n\n` +
        "Mit freundlichen Grüßen\nMAWA Trading Distribution\noffice@mawa-trading.com\n",
    });

    return {
      ok: true,
      message:
        "Vielen Dank! Ihre Anfrage wurde versendet – eine Bestätigung ist an Ihre E-Mail-Adresse unterwegs.",
    };
  });

