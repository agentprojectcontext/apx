import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? files(name) : [name];
  });

/** Compare structure, not translated words; semantic parity remains a review responsibility. */
export function translationErrors(pages) {
  const errors = [];
  for (const [name, text] of pages) {
    if (name.startsWith("es/")) {
      if (!pages.has(name.slice(3))) errors.push(`${name}: missing English page`);
      continue;
    }
    const translated = pages.get(`es/${name}`);
    if (translated === undefined) {
      errors.push(`${name}: missing Spanish page`);
      continue;
    }
    const levels = (value) =>
      [...value.replace(/```[\s\S]*?```/g, "").matchAll(/^(#{2,6})\s/gm)].map((match) => match[1].length).join(",");
    if (levels(text) !== levels(translated)) errors.push(`${name}: EN/ES heading structure differs`);
  }
  return errors;
}

/** Validate literal local links against built routes and fragment ids, including the published base. */
export function linkErrors(pages, base = "/apx") {
  base = base.replace(/\/+$/, "");
  const errors = [];
  const origin = "https://docs.invalid";
  for (const [route, html] of pages) {
    for (const match of html.matchAll(/\bhref="([^"]+)"/g)) {
      const href = match[1].replaceAll("&amp;", "&");
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      const url = new URL(href, `${origin}${base}${route}`);
      if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
        errors.push(`${route}: link outside base: ${href}`);
        continue;
      }
      const target = decodeURIComponent(url.pathname.slice(base.length)) || "/";
      const body = pages.get(target) ?? pages.get(`${target}/`);
      if (body === undefined) {
        // File downloads and assets are outside this route/fragment check.
        if (!path.posix.extname(target)) errors.push(`${route}: missing route: ${href}`);
        continue;
      }
      if (url.hash) {
        const id = decodeURIComponent(url.hash.slice(1));
        const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((item) => item[1]);
        if (!ids.includes(id)) errors.push(`${route}: missing fragment: ${href}`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = path.join(root, "src/content/docs");
  const pages = new Map(
    files(source)
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => [path.relative(source, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")]),
  );
  const dist = path.join(root, "dist");
  const built = new Map(
    files(dist)
      .filter((file) => path.basename(file) === "index.html")
      .map((file) => [path.relative(dist, path.dirname(file)).split(path.sep).join("/")])
      .map(([route]) => [
        `/${route}${route ? "/" : ""}`,
        fs.readFileSync(path.join(dist, route, "index.html"), "utf8"),
      ]),
  );
  const errors = [...translationErrors(pages), ...linkErrors(built, process.env.DOCS_BASE ?? "/")];
  for (const error of errors) console.error(error);
  console.log(`${pages.size} source pages, ${built.size} built routes; ${errors.length} errors`);
  process.exitCode = errors.length ? 1 : 0;
}
