import { injectSurfaceHead } from "../../../../packages/surfaces/src/widget-kit.ts";

// An ```html block an agent wrote, as the document its preview frame shows. The page is untrusted: the frame is
// sandboxed with an opaque origin, and this CSP lets only the host's own sizing script run and nothing load from the web.

const csp = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'`;

/** The message a preview frame posts with its page's height; `key` tells it from anything else posting. */
export interface PreviewHeight {
  apxPreview: string;
  height: number;
}

export function isPreviewHeight(m: unknown, key: string): m is PreviewHeight {
  if (typeof m !== "object" || m === null) return false;
  const { apxPreview, height } = m as Record<string, unknown>;
  return apxPreview === key && typeof height === "number" && Number.isFinite(height);
}

/**
 * The block's HTML with a head that locks it down and reports its height (the `nonce` both lets that script run and
 * marks its messages). A light page by default, as a browser would show it; the page's own styles win.
 */
export function htmlPreviewDoc(html: string, nonce: string): string {
  const key = JSON.stringify(nonce);
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp(nonce)}">
<style>html{color-scheme:light;background:#fff;color:#111;font-family:system-ui,sans-serif}</style>
<script nonce="${nonce}">(function(){var last=0;function size(){var h=Math.ceil(document.documentElement.offsetHeight);if(h!==last){last=h;parent.postMessage({apxPreview:${key},height:h},"*");}}
addEventListener("load",size);document.addEventListener("DOMContentLoaded",size);if(window.ResizeObserver)new ResizeObserver(size).observe(document.documentElement);})();</script>`;
  return injectSurfaceHead(html, head);
}
