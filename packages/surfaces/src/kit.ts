/** Where a surface asks for the APX Kit. Nothing is fetched from there: hosts inline the kit in place of the tag. */
export const KIT_PATH = "/_apx/kit@1.js";

/** `<script src="/_apx/kit@1.js"></script>`, with or without quotes, other attributes or a minor version (kit@1.2.js). */
const KIT_TAG = /<script\b[^>]*\bsrc\s*=\s*["']?\/_apx\/kit@1(?:\.\d+){0,2}\.js["']?[^>]*>\s*<\/script\s*>/gi;

export function usesKit(html: string): boolean {
  KIT_TAG.lastIndex = 0;
  return KIT_TAG.test(html);
}

/**
 * The first kit tag replaced by the kit itself, inline, so it runs under a CSP without network; any repeat is dropped.
 * The source cannot close its own <script> element early.
 */
export function inlineKit(html: string, kit: string): string {
  let first = true;
  const body = kit.replace(/<\/(script)/gi, "<\\/$1");
  return html.replace(KIT_TAG, () => {
    if (!first) return "";
    first = false;
    return `<script data-apx-kit>${body}</script>`;
  });
}

/** `<meta name="apx-surface" content="app">` or `<html data-ax-surface="app">`: the page was written as a full app. */
export function declaresApp(html: string): boolean {
  return (
    /<meta\b(?=[^>]*\bname\s*=\s*["']?apx-surface\b)(?=[^>]*\bcontent\s*=\s*["']?app\b)[^>]*>/i.test(html) ||
    /<html\b[^>]*\bdata-ax-surface\s*=\s*["']?app\b/i.test(html)
  );
}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** "on" → kept while the host has room (Infinity); "15m", "30s", "2h", "1d" → that long after last seen. */
export function parseLiveDuration(value: string): number | undefined {
  const v = value.trim().toLowerCase();
  if (v === "on" || v === "true") return Number.POSITIVE_INFINITY;
  const m = /^(\d{1,6})\s*([smhd])$/.exec(v);
  if (!m) return undefined;
  const ms = Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
  return ms > 0 ? ms : undefined;
}

/**
 * `<meta name="apx-live" content="on">` (or a duration): the page keeps running while hidden, for that long after it
 * was last seen. Returns that time in ms, or undefined when the page is not live (no tag, "off", unreadable).
 */
export function declaresLive(html: string): number | undefined {
  const tag = /<meta\b(?=[^>]*\bname\s*=\s*["']?apx-live\b)[^>]*>/i.exec(html)?.[0];
  if (!tag) return undefined;
  const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
  return content ? parseLiveDuration(content[1] ?? content[2] ?? content[3] ?? "") : undefined;
}
