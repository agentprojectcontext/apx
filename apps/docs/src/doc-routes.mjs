/** Convert recursive directory entries from either platform into canonical documentation URLs. */
export function builtDocumentationRoutes(entries, prefix = "") {
  return entries
    .map((entry) => entry.replace(/\\/g, "/"))
    .filter((entry) => entry.endsWith("index.html") && entry !== "index.html")
    .map((entry) => `${prefix}docs/${entry.replace(/index\.html$/, "")}`);
}

export const docSections = [
  "start",
  "concepts",
  "office",
  "apps",
  "computers",
  "channels",
  "extend",
  "devices",
  "reference",
];

/** @param {string} path Map an address without changing web pages or assets. */
export function documentationPath(path) {
  return path.replace(new RegExp(`^(/es)?/(${docSections.join("|")})(?=/|$)`), "$1/docs/$2");
}

/** @param {string} entry */
export function documentationId(entry) {
  const slug = entry.replace(/\.(?:mdx?|markdown)$/, "");
  return slug.startsWith("es/") ? `es/docs/${slug.slice(3)}` : `docs/${slug}`;
}

/** @param {string} path @param {string} base */
export function sitePath(path, base = "/") {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const prefix = base.replace(/\/$/, "");
  const addressSegments = path.split("/");
  const baseSegments = prefix.split("/");
  const hasBase =
    prefix &&
    addressSegments.length > baseSegments.length &&
    baseSegments.every((segment, i) => segment === addressSegments[i]);
  const local = hasBase ? path.slice(prefix.length) : path;
  return `${prefix}${documentationPath(local)}`;
}
