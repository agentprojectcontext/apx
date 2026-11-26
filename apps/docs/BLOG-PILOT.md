# Blog editorial recipe

## Purpose and cadence

Publish one original, useful article in English and Spanish every two days. SEO is the main acquisition goal, not a reason to pad prose or repeat topics. The owner approved the pilot and requested production publication and a recurring workflow on November 20, 2026. Keep this workflow separate from DEV Community syndication and the daily SEO measurement routine.

## Research before writing

1. Read every published article and draft, not just slugs; reject semantic duplicates. The initial November 20 inventory held 30 published article pairs and 15 original draft pairs. Recount on every run.
2. Find a specific public issue, discussion or review about an agent workflow. Read the primary source, check its date, version, reproduction and current status. Link it. A single report is not evidence of universal failure; a development build is not every released version.
3. Define the reader's problem and a distinct search intent in each language. Use Search Console queries when available. Otherwise label candidate phrases as editorial hypotheses, never measured search volume.
4. Give a practical solution first, then an APX section grounded in current documentation and verified behavior. Do not imply that APX is immune to a class of failures. State relevant limits naturally. Never invent benchmarks, credentials, reviews or product capabilities.
5. Write a substantial, focused article: clear opening, explanatory subheadings, actionable steps, sources and contextual internal links. No word-count padding, keyword stuffing or templated comparison claims. Spanish uses voseo; English is idiomatic, not a literal translation.

## Shared author

`src/data/blog-author.mjs` is the single source for the author name, handle, biography and links in both languages. `src/assets/people/author.png` supplies the owner-approved portrait. All existing and future articles use the shared layout: do not paste separate author biographies into Markdown. Preserve original dates on existing articles.

## Cover art: continuity with variation

Review the existing covers before generating. They share a dark blue editorial palette, no embedded words and a wide 16:9 composition, but they are not all the same rendering style. Alternate the existing visual families, using actual reference assets rather than interpreting these labels as a new design:

- Bright cyan/violet 3D glass symbols and connected objects: `src/assets/blog/ai-agent-browser-login-safely/hero.webp` and `ai-agent-mcp-connection/hero.webp`. The attachment pilot belongs here.
- Restrained abstract geometry, dark blue planes and soft luminous connections: `src/assets/blog/ai-agent-chat-apps/hero.webp`.
- Illustrative workflow scenes with small robots, people or task objects: `src/assets/blog/ai-agent-skill-checklist/hero.webp` and `ai-agent-team-small-business/hero.webp`.

Within each family vary the subject and composition: a focal object, a relationship or a grouped workflow. Do not make every article another bright glass pair. Use the selected existing cover as a visual reference, choose a new subject that explains the article, inspect the result, and reject off-style outputs. Do not reuse an unrelated cover to fill a missing asset.

Pilot prompt: “Minimal premium editorial 3D illustration about an AI agent losing access to an attachment in a long conversation. Match the reference's art direction, not its subject: midnight navy background, translucent rounded glass forms with cyan and violet glowing edges, soft reflections on a dark floor. On the left a floating document with an abstract paperclip, on the right a compact stack of conversation bubbles. A luminous connection between them has a clear small gap, representing lost working context. Simple balanced wide composition, no text, letters, logos or watermark.” Reference: `src/assets/blog/ai-agent-browser-login-safely/hero.webp`.

Convert the inspected output to 1600 × 900 WebP (quality 88 in the pilot). Store it in `src/assets/blog/<slug>/hero.webp`; use the same asset in the two frontmatters with localized alt text and a conceptual-illustration caption. Astro generates responsive images and the social preview. The cover belongs above the title.

Real panel screenshots or videos, when relevant, belong inside the article, not in place of the conceptual cover. Use current, reviewed captures without personal data. Explain what they show. A screenshot is not proof that the described action succeeded; verify the path separately. Omit media when no relevant verified resource exists.

## SEO and publication checks

- Unique title and concise description aligned with the actual search intent, one H1, logical H2/H3 structure and useful descriptive links. No ranking guarantees.
- Same stable slug for ES/EN, localized prose and image alternatives; reciprocal language alternates, absolute self-canonical URL and indexable published routes.
- BlogPosting JSON-LD with real author, publication date, image and source citations. Cover loads at desktop and phone widths, with explicit dimensions and responsive variants. Check browser errors and overflow.
- Audit all published blog routes for titles, descriptions, canonical, alternates, structured data, sources and sitemap inclusion, not only the newest post. Check archive pagination and language switching.
- Build and check the site under `/` and `/apx/` as described in `BLOG.md`. Run browser checks at desktop and phone widths, in both languages and themes. Request one complete independent review; fix material findings before deployment.
- Set `draft: false` in both translations only when ready; use the actual publication date. Follow project branch and verification rules. Deploy only intended site changes, never unrelated runtime commits. No app release or tag is needed.
- Verify the two public URLs, loaded cover and portrait, author, language switching, canonical, structured data and sitemap after deployment. A successful push is not proof of a published page.

## Pilot evidence and measurement

Pilot slug: `ai-agent-attachment-context-loss`, publication date November 20, 2026. Primary source rechecked that day: [OpenCode issue #60511](https://github.com/anomalyco/opencode/issues/60511), still open and labeled reproduced. The article distinguishes that development-commit report from APX's documented project/task/compaction workflows; no APX immunity or runtime reproduction is claimed. Candidate phrases include “AI agent loses attachment” and “agente IA pierde archivo adjunto”; these are not measured search-volume claims.

After publication, measure indexability first, then Search Console impressions, clicks, CTR and relevant queries by article and language over 7/28 days. Keep observations separate from attribution: one post or technical validation does not prove organic growth. Do not change titles solely on a few early impressions.

Docs impact: updated — this recipe, `BLOG.md` and `BLOG.es.md` describe the central author, visual continuity, editorial research, SEO checks and publication workflow.
