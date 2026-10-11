// @ts-check
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// Where the site is published. Pages write absolute links ("/concepts/agents/"); withBase() below puts this prefix in
// front of them, so moving the site (e.g. under /apx/docs/) only changes these two values.
const site = process.env.DOCS_SITE ?? "https://agentprojectcontext.github.io";
const base = (process.env.DOCS_BASE ?? "/").replace(/\/?$/, "/");

/** A remark plugin: absolute links in Markdown and `href`s on components (LinkCard…) get the site's base. */
function withBase() {
  /** @param {string} url */
  const fix = (url) => (base !== "/" && /^\/(?!\/)/.test(url) && !url.startsWith(base) ? base + url.slice(1) : url);
  /** @param {any} node */
  const walk = (node) => {
    if (node.type === "link" || node.type === "definition") node.url = fix(node.url);
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement")
      for (const a of node.attributes ?? [])
        if (a.name === "href" && typeof a.value === "string") a.value = fix(a.value);
    for (const child of node.children ?? []) walk(child);
  };
  return walk;
}

/** The install scripts are served beside the site (<base>install.sh), copied from scripts/install/ at build time. */
function installScripts() {
  const from = new URL("../../scripts/install/", import.meta.url);
  return {
    name: "apx-install-scripts",
    hooks: {
      /** @param {{ dir: URL }} options */
      "astro:build:done": async ({ dir }) => {
        for (const file of ["install.sh", "install.ps1"])
          await copyFile(fileURLToPath(new URL(file, from)), fileURLToPath(new URL(file, dir)));
      },
    },
  };
}

const section = (/** @type {string} */ label, /** @type {string} */ es, /** @type {string} */ directory) => ({
  label,
  translations: { es },
  items: [{ autogenerate: { directory } }],
});

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  devToolbar: { enabled: false },
  markdown: { remarkPlugins: [withBase] },
  // <base>docs/ is the address to give for "the docs": it lands on the first page. Destinations are not given the base.
  redirects: { "/docs": `${base}start/introduction/`, "/es/docs": `${base}es/start/introduction/` },
  integrations: [
    installScripts(),
    starlight({
      title: "APX",
      description: "APX: a crew of AI agents that lives on your machine. Documentation for APX v2.",
      logo: { src: "./src/assets/logo.png", alt: "APX" },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/theme.css"],
      head: [
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: true } },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Geist+Mono:wght@400;500;600&display=swap",
          },
        },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/agentprojectcontext/apx" },
        { icon: "discord", label: "Discord", href: "https://discord.gg/vxdZuT5WuE" },
      ],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        es: { label: "Español", lang: "es" },
      },
      components: { Footer: "./src/components/Footer.astro" },
      lastUpdated: false,
      sidebar: [
        section("Start here", "Empezar", "start"),
        section("Core ideas", "Ideas clave", "concepts"),
        section("Your office", "Tu oficina", "office"),
        section("Channels", "Canales", "channels"),
        section("Extend", "Extender", "extend"),
        section("Everywhere", "En todos lados", "devices"),
        section("Reference", "Referencia", "reference"),
      ],
    }),
  ],
});
