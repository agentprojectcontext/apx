export const BLOG = {
  en: {
    title: "The APX blog",
    description: "Research and practical guides for choosing and using AI assistants.",
    emptyTitle: "Our first articles are on the way",
    empty: "For now, explore our comparisons of AI assistants and how they work.",
    compare: "Explore comparisons",
    back: "All articles",
    sources: "Sources",
    published: "Published",
    updated: "Updated",
    read: "Read article",
    language: "en-US",
  },
  es: {
    title: "El blog de APX",
    description: "Investigación y guías prácticas para elegir y usar asistentes de IA.",
    emptyTitle: "Estamos preparando los primeros artículos",
    empty: "Mientras tanto, explorá nuestras comparativas de asistentes de IA y cómo funcionan.",
    compare: "Explorá las comparativas",
    back: "Todos los artículos",
    sources: "Fuentes",
    published: "Publicado",
    updated: "Actualizado",
    read: "Leer artículo",
    language: "es-AR",
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

export function blogPath(data) {
  return `${data.lang === "es" ? "/es" : ""}/blog/${data.slug}/`;
}
