# Editorial blog

The blog is a static part of the marketing site at `/blog/` and `/es/blog/`, separate from documentation and comparisons. It uses the shared header, footer, theme, consent and metadata components. No CMS, extra analytics, runtime core method or dependency is added. These routes are development work until separately integrated and deployed.

## Add an article

Write paired Markdown files under `src/content/blog/en/` and `src/content/blog/es/`. Use the same URL slug in each language. The content collection validates frontmatter; publication fails if a non-draft article has no non-draft translation or duplicate slug/language. Drafts never enter the list, routes or sitemap. Dates are explicit UTC calendar dates, not inferred from filesystem changes. The blog may be empty; it never repackages comparisons as new research.

```yaml
---
title: A descriptive article title
description: A plain-language summary under 160 characters.
lang: en
slug: article-topic
draft: true
published: "2026-01-01"
sources:
  - label: A specific primary source
    url: https://example.com/research/topic
    checked: "2026-01-01"
---
```

Translate the title, description and body; change `lang` to `es` in the Spanish file. Optional `updated` must not predate `published`. Set `draft: false` in both files only after editorial approval. The detail page renders the Markdown and a linked sources list. Canonical URLs, language alternatives, article metadata and sitemap use the configured `DOCS_SITE` and `DOCS_BASE`.

## Images and one shared layout

All listings and articles use `src/components/blog/BlogPage.astro` and `blog.css`. Redesign these once, not each Markdown file. The marketing site uses shared Astro CSS; this feature does not introduce Tailwind or another styling stack.

Store local images in `src/assets/blog/<slug>/`, not `public/`, so Astro can validate the file, read real dimensions and generate WebP variants. Add optional frontmatter in each translation:

```yaml
image:
  src: ../../../assets/blog/article-topic/hero.webp
  alt: A localized description of what the illustration shows.
  caption: Conceptual illustration, not a screenshot.
```

The path is relative to a Markdown file in `src/content/blog/en/` or `es/`. English and Spanish may share the same asset but must localize alt text and captions. Alt text cannot be empty. No width/height fields are needed: Astro reads them from the original. Prefer 1600 × 900 banners with consistent art direction and no embedded text. The shared layout uses responsive `srcset` and `sizes`, explicit dimensions, an eager article cover and lazy listing thumbnails, without upscaling smaller originals. The article cover also supplies its social preview and structured-data image; articles without a cover retain the existing localized site preview.

Use Markdown images with descriptive alt text and relative paths to the same asset folder for inline illustrations or screenshots. Prefer current real APX captures when describing an actual workflow; do not present a generated banner as a screenshot. Confirm asset rights and distinguish conceptual imagery from real product UI in captions. Do not commit verification images or sample articles.

The shared article header places the cover before the title and summary, with a compact offset below the fixed navigation. Articles retain a bounded reading column; this layout does not need per-article changes.

## Archive navigation

The archive shows ten published articles per page, newest first, in the selected language. The first page stays at `/blog/` (`/es/blog/`); later pages use `/blog/page/2/` and `/es/blog/page/2/`. Previous/next links, language switching, canonical URLs, alternate-language links and the sitemap preserve the page number. Only pages with articles are generated. The header's Blog menu shows up to four recent published articles, never drafts.

For pagination verification, build with more than ten disposable bilingual articles and run `node scripts/blog-pagination.browser.mjs` against the preview. Remove all fixtures and rebuild before publication. `node scripts/blog-navigation.browser.mjs` checks header navigation and active states at desktop and phone widths.

## Research and approval

Coordinate topics, search intent and publication with the existing SEO work. Every factual claim needs relevant, checked evidence; requiring a source in frontmatter does not certify the prose. Distinguish a user's report from a reproducible product limitation. Identify version/date and context; do not generalize an isolated complaint or invent ratings, quotations, metrics or capabilities. Avoid personal identifiers from reviews. Prefer primary issue threads, documentation and reproducible observations. Describe where APX is relevant and where it is not, using verified capabilities. Do not publish unapproved research or present existing comparisons as newly investigated complaints.

Reel-to-article conversion is later editorial work, not automatic transcription or publication in this implementation.

## Verification and deployment

Run the standalone frozen install, build and checks from `apps/docs` with `DOCS_BASE=/` and `/apx/`. Validate a paired disposable article and draft, including sources, Markdown, language switching and sitemap exclusion, without committing sample editorial content. Inspect desktop and phone widths. Publication is separate: this change does not alter the Pages workflow or authorize a push, release or deploy.

Browser checks run with `node scripts/blog.browser.mjs` from the site directory (Playwright is provided by the root workspace). Set `DOCS_TEST_URL` to the running preview, including `/apx` when testing that base. With a disposable bilingual article, set `DOCS_TEST_ARTICLE_SLUG` to its slug; keep a draft named `unpublished-draft` to exercise the negative path. For the disposable 1600 × 900 cover fixture, also set `DOCS_TEST_IMAGE=1` to check responsive variants, actual image loading, caption and social-preview dimensions. Set `DOCS_TEST_OUTPUT` to a temporary folder for screenshots. The checks cover reading, sources, dates, language switching, themes, the mobile menu, header overlap, sitemap membership and draft exclusion. Run the ordinary empty build separately without the article-slug variable. Never add verification articles to a production build.

Docs impact: updated — this guide and its Spanish counterpart document article preparation, explicit bilingual publication, evidence requirements and deployment limits.
