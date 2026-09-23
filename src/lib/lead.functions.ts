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

export const submitCustomerLead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => leadSchema.parse(input))
  .handler(async ({ data }): Promise<LeadResult> => {
    // Der E-Mail-Versand wird aktiviert, sobald die Absenderdomain eingerichtet ist.
    console.log("[lead] Neukunden-Anfrage", {
      company: data.company,
      email: data.email,
      country: data.country,
    });
    return {
      ok: false,
      message:
        "Der automatische Versand ist noch nicht freigeschaltet. Bitte wenden Sie sich vorerst direkt an office@mawa-trading.com.",
    };
  });
