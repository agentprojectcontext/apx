// Who APX is, said the same way everywhere: the one-line definition, its public profiles and the Organization that
// search engines tie them to. Directory listings and social bios reuse the same sentence.
export const SITE = "https://apxagent.app";
export const REPO = "https://github.com/agentprojectcontext/apx";

export const DEFINITION = {
  en: "APX is a free, open-source desktop app that runs your own team of AI agents on your machine.",
  es: "APX es una app de escritorio gratis y open source para tener tu propio equipo de agentes de IA en tu máquina.",
} as const;

/** Every public profile of APX; each one goes to the footer and to `sameAs`. Add a profile here when it exists. */
export const PROFILES = [
  { name: "GitHub", url: REPO, footer: true },
  { name: "Discord", url: "https://discord.gg/vxdZuT5WuE", footer: true },
  { name: "YouTube", url: "https://www.youtube.com/@apx-agents", footer: true },
  { name: "GitHub organization", url: "https://github.com/agentprojectcontext", footer: false },
  { name: "Product Hunt", url: "https://www.producthunt.com/products/apx", footer: false },
] as const;

export const ORGANIZATION_ID = `${SITE}/#organization`;
export const SOFTWARE_ID = `${SITE}/#software`;

/** The schema.org Organization behind the site; other objects point at it by `@id`. */
export function organization(logo: string, lang: "en" | "es") {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "APX",
    alternateName: ["APX agents", "APX Agent"],
    url: `${SITE}/`,
    logo,
    description: DEFINITION[lang],
    foundingLocation: { "@type": "Country", name: "Argentina" },
    sameAs: PROFILES.map((profile) => profile.url),
  };
}
