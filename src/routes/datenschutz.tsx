import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import text from "@/data/datenschutz.txt?raw";

export const Route = createFileRoute("/datenschutz")({
  head: () => ({
    meta: [
      { title: "Datenschutzerklärung — MAWA Trading GmbH" },
      { name: "description", content: "Informationen zur Verarbeitung personenbezogener Daten im MAWA B2B-Shop." },
      { property: "og:title", content: "Datenschutzerklärung — MAWA Trading GmbH" },
      { property: "og:description", content: "Informationen zur Verarbeitung personenbezogener Daten im MAWA B2B-Shop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LegalPage title="Datenschutzerklärung" text={text} />,
});
