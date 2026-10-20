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
