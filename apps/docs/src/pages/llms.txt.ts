import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { comparisons } from "../data/comparisons";
import { roundupTitle } from "../data/roundup/index.ts";
import { docSections } from "../doc-routes.mjs";
import { HOME } from "../i18n/home";

// The site as a map for language models (llmstxt.org): what APX is, then every English guide page with its summary.
const sectionNames: Record<string, string> = {
  start: "Start here",
  concepts: "Core ideas",
  office: "Your office",
  channels: "Channels",
  extend: "Extend",
  devices: "Everywhere",
  reference: "Reference",
};

export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  const url = (path: string) => new URL(`${base}${path.replace(/^\//, "")}`, site).href;
  const docs = (await getCollection("docs")).filter((entry) => entry.id.startsWith("docs/"));
  const order = (entry: (typeof docs)[number]) => entry.data.sidebar?.order ?? 999;
  const t = HOME.en;
  const lines = [
    "# APX",
    "",
    `> ${t.sub.strong} ${t.sub.rest}`,
    "",
    "APX is open source (MIT) and runs on macOS, Windows, Linux and Android, or on a server. Its agents keep their memory in plain files, talk through Telegram, WhatsApp, Discord, Slack and iMessage, and work with Claude Code, Codex or any model API. Every page is also in Spanish under /es/.",
    "",
    "Install from a terminal: `curl -fsSL https://apxagent.app/install.sh | bash` (Windows: `irm https://apxagent.app/install.ps1 | iex`).",
  ];
  for (const section of docSections) {
    const pages = docs.filter((entry) => entry.id.split("/")[1] === section).sort((a, b) => order(a) - order(b));
    if (pages.length === 0) continue;
    lines.push("", `## ${sectionNames[section] ?? section}`, "");
    for (const entry of pages)
      lines.push(
        `- [${entry.data.title}](${url(`/${entry.id}/`)})${entry.data.description ? `: ${entry.data.description}` : ""}`,
      );
  }
  lines.push("", "## Compare", "", `- [${roundupTitle.en}](${url("/compare/best-ai-agent-apps/")})`);
  for (const item of comparisons)
    lines.push(`- [APX vs ${item.name}](${url(`/compare/${item.slug}/`)}): ${item.tagline.en}`);
  lines.push(
    "",
    "## Optional",
    "",
    `- [Download the app](${url("/#download")})`,
    "- [Source code](https://github.com/agentprojectcontext/apx)",
  );
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
