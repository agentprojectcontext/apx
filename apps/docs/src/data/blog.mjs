export const BLOG = {
  en: {
    title: "Research on AI assistants",
    description: "Analysis and sources to help you choose.",
    emptyTitle: "No articles have been published yet.",
    empty: "In the meantime, explore the comparisons.",
    compare: "See comparisons",
    back: "All articles",
    sources: "Sources",
    related: "More articles",
    published: "Published",
    updated: "Updated",
    read: "Read article",
    language: "en-US",
    previous: "Previous",
    next: "Next",
    pagination: "Article pages",
    page: "Page",
  },
  es: {
    title: "Investigaciones sobre asistentes de IA",
    description: "Análisis y fuentes para ayudarte a elegir.",
    emptyTitle: "Todavía no hay artículos publicados.",
    empty: "Mientras tanto, podés explorar las comparaciones.",
    compare: "Ver comparaciones",
    back: "Todos los artículos",
    sources: "Fuentes",
    related: "Más artículos",
    published: "Publicado",
    updated: "Actualizado",
    read: "Leer artículo",
    language: "es-AR",
    previous: "Anterior",
    next: "Siguiente",
    pagination: "Páginas de artículos",
    page: "Página",
  },
};

/** Publishing is bilingual and explicit; drafts never produce a route or enter the listing. */
export function publishedPosts(entries) {
  const posts = entries.filter(({ data }) => !data.draft);
  const keys = new Set();
  for (const { data } of posts) {
    const key = `${data.lang}/${data.slug}`;
    if (keys.has(key)) throw new Error(`Duplicate blog article: ${key}`);
    keys.add(key);
    if (data.updated && data.updated < data.published) throw new Error(`Update precedes publication: ${key}`);
  }
  for (const { data } of posts) {
    const other = data.lang === "en" ? "es" : "en";
    if (!keys.has(`${other}/${data.slug}`)) throw new Error(`Missing blog translation: ${other}/${data.slug}`);
  }
  return posts.sort(
    (a, b) => b.data.published.localeCompare(a.data.published) || a.data.slug.localeCompare(b.data.slug),
  );
}

export function relatedPosts(entries, post) {
  return publishedPosts(entries)
    .filter(({ data }) => data.lang === post.data.lang && data.slug !== post.data.slug)
    .slice(0, 3);
}

export function archivePath(page = 1) {
  return page === 1 ? "/blog/" : `/blog/page/${page}/`;
}

export function blogArchive(entries, lang, page = 1) {
  const posts = publishedPosts(entries).filter(({ data }) => data.lang === lang);
  const totalPages = Math.max(1, Math.ceil(posts.length / 10));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) throw new Error("Invalid blog page");
  return { posts: posts.slice((page - 1) * 10, page * 10), totalPages };
}

export function blogPath(data) {
  return `${data.lang === "es" ? "/es" : ""}/blog/${data.slug}/`;
}
