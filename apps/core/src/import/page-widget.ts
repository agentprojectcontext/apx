// An HTML page from a project's folder made into a widget: local scripts and styles inlined (a widget loads nothing
// from disk by URL), images and videos turned into folder references the widget host loads (data-apx-src).
import fs from "node:fs";
import path from "node:path";
import { isInside, samePath } from "../paths.ts";

const PAGE_BYTES = 2 * 1024 * 1024;
const WIDGET_CHARS = 400_000;

const remote = (ref: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);

/** A file the page names, when it is inside the project's folder. */
function local(root: string, dir: string, ref: string): string | undefined {
  if (!ref || remote(ref)) return undefined;
  const abs = path.resolve(dir, decodeURI(ref.split(/[?#]/)[0] ?? ""));
  return isInside(root, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : undefined;
}

/** The page as a widget's HTML and its title; throws a reason the owner can act on. */
export function pageAsWidget(projectRoot: string, file: string): { html: string; title: string } {
  const root = path.resolve(projectRoot);
  const abs = path.resolve(root, file);
  if (samePath(root, abs) || !isInside(root, abs)) throw new Error(`${file} is not in the project's folder`);
  if (!/\.html?$/i.test(abs)) throw new Error(`${file} is not an HTML page`);
  if (!fs.existsSync(abs)) throw new Error(`${file} is not there`);
  if (fs.statSync(abs).size > PAGE_BYTES) throw new Error(`${file} is too big for a widget`);
  const dir = path.dirname(abs);
  let html = fs.readFileSync(abs, "utf8");
  html = html.replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const css = local(root, dir, /\bhref=["']([^"']+)["']/i.exec(tag)?.[1] ?? "");
    return css ? `<style>\n${fs.readFileSync(css, "utf8")}\n</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, pre, ref, post) => {
    const js = local(root, dir, ref);
    return js
      ? `<script${pre}${post}>\n${fs.readFileSync(js, "utf8").replaceAll("</script", "<\\/script")}\n</script>`
      : tag;
  });
  html = html.replace(/\b(src|poster)=(["'])([^"']+)\2/gi, (attr, name: string, q: string, ref: string) => {
    const media = local(root, dir, ref);
    if (!media) return attr;
    const rel = path.relative(root, media).split(path.sep).join("/");
    return `data-apx-${name.toLowerCase() === "poster" ? "poster" : "src"}=${q}${rel}${q}`;
  });
  if (html.length > WIDGET_CHARS)
    throw new Error(`${file} is over ${WIDGET_CHARS / 1000} KB once its scripts and styles are in`);
  const title = /<title>([^<]{1,120})<\/title>/i.exec(html)?.[1]?.trim() || path.basename(abs).replace(/\.html?$/i, "");
  return { html, title };
}
