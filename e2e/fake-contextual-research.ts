import type { DiscoveryWeb } from "../apps/core/src/engine/discovery-research.ts";

const quote = "Acme now supports a documented portable export format.";
export const fakeDiscoveryWeb: DiscoveryWeb = {
  async search() {
    return ["https://research.example/news"];
  },
  async read(url) {
    if (!url.startsWith("https://research.example/")) throw new Error("No research fixture for this source");
    return { url, title: "Acme release notes", text: quote, read_at: "2099-05-01T08:00:00.000Z" };
  },
};

export function fakeDiscoveryReply(system: string, user: string): string | undefined {
  if (system.startsWith("Discover one worthwhile"))
    return JSON.stringify({
      question: "Could the public export format simplify the workflow?",
      rationale: "Check capabilities before planning the export.",
    });
  if (system.startsWith("Independently check"))
    return JSON.stringify({
      supported: true,
      relevant: true,
      new_topic: true,
      limitation: "Compatibility remains untested.",
    });
  if (!system.startsWith("Investigate a useful question")) return;
  const input = JSON.parse(user) as { reference: string };
  const reference = JSON.parse(input.reference) as { today: string; language: string };
  const spanish = reference.language === "es";
  return JSON.stringify({
    findings: [
      {
        topic: "Acme portable export",
        title: spanish ? "Un formato para simplificar tus exportaciones" : "A format to simplify your exports",
        summary: spanish
          ? "Acme documentó un formato portable que podría servir para el trabajo de exportación previsto."
          : "Acme documented a portable format that could help the planned export workflow.",
        action: spanish
          ? "Compará el formato con los requisitos antes de cambiar el plan."
          : "Compare the format with your requirements before changing the plan.",
        uncertainty: spanish ? "La compatibilidad todavía no se probó." : "Compatibility has not been tested.",
        expires_at: new Date(Date.parse(reference.today) + 3 * 86_400_000).toISOString(),
        relevance: 4,
        impact: 4,
        novelty: 4,
        actionable: 4,
        timely: 3,
        local: 0,
        evidence: [{ page: 0, quote }],
      },
    ],
  });
}
