/** The public page's head as search engines and link previews read it: they never run the viewer's script. */

export type SignIn = { project: string; apiKey: string };

const safe = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The Firebase web client the page signs in with, or none when the Worker was deployed without one. */
export function signInConfig(env: { FIREBASE_PROJECT: string; FIREBASE_WEB_KEY?: string }): SignIn | undefined {
  const apiKey = env.FIREBASE_WEB_KEY?.trim();
  if (!apiKey || !/^[A-Za-z0-9_-]{20,80}$/.test(apiKey)) return undefined;
  return { project: env.FIREBASE_PROJECT, apiKey };
}

/** The embedded viewer page with this copy's title, description, preview image and canonical link. */
export function copyPage(
  html: string,
  page: {
    origin: string;
    code: string;
    copy?: { title: string; updated_at: string };
    signIn?: SignIn;
  },
): string {
  const url = `${page.origin}/${page.code}`;
  const icons = [
    `<link rel="icon" type="image/png" sizes="64x64" href="/icon.png">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
  ];
  const config = page.signIn ? [`<meta name="apx-sign-in" content="${safe(JSON.stringify(page.signIn))}">`] : [];
  if (!page.copy)
    return inject(html, [`<title>Not available · APX</title>`, `<meta name="robots" content="noindex">`, ...icons]);
  const title = page.copy.title;
  const description = `${title}, shared with APX. Your own team of AI agents, on your machine.`;
  const data = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: title,
    url,
    dateModified: page.copy.updated_at,
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "APX", url: "https://apxagent.app", logo: `${page.origin}/icon.png` },
  };
  return inject(
    html,
    [
      `<title>${safe(title)} · APX</title>`,
      `<meta name="description" content="${safe(description)}">`,
      `<link rel="canonical" href="${safe(url)}">`,
      ...icons,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="APX">`,
      `<meta property="og:title" content="${safe(title)}">`,
      `<meta property="og:description" content="${safe(description)}">`,
      `<meta property="og:url" content="${safe(url)}">`,
      `<meta property="og:image" content="${page.origin}/og.jpg">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${safe(title)}">`,
      `<meta name="twitter:description" content="${safe(description)}">`,
      `<meta name="twitter:image" content="${page.origin}/og.jpg">`,
      ...config,
      `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`,
    ],
    `<main><h1>${safe(title)}</h1><p>Shared with <a href="https://apxagent.app">APX</a>, your own team of AI agents.</p></main>`,
  );
}

function inject(html: string, head: string[], body = "") {
  return html
    .replace(/<title>[^<]*<\/title>/, head.join("\n    "))
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}
