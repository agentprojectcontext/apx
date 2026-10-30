import type { APIRoute } from "astro";

// Every page may be crawled; the sitemap lists them, wherever the site is published.
export const GET: APIRoute = ({ site }) =>
  new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${new URL(`${import.meta.env.BASE_URL.replace(/\/?$/, "/")}sitemap-index.xml`, site)}\n`,
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
