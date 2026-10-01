import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";
import text from "@/data/impressum.txt?raw";

export const Route = createFileRoute("/impressum")({
  head: () => ({
    meta: [
      { title: "Impressum — MAWA Trading GmbH" },
      { name: "description", content: "Impressum und Anbieterangaben der MAWA Trading GmbH." },
      { property: "og:title", content: "Impressum — MAWA Trading GmbH" },
      { property: "og:description", content: "Impressum und Anbieterangaben der MAWA Trading GmbH." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LegalPage title="Impressum" text={text} />,
});
