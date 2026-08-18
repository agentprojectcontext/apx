# Docs site

> Deep dive for [`AGENTS.md`](../AGENTS.md). Read before editing the public
> docs. Rule **6** in the hub is the always-read "docs stay in sync" constraint.

`docs/` — Astro 6 + Starlight, self-contained, bilingual (EN at `src/content/docs/<section>/`, ES at `…/es/<section>/` with the same slug — edit both). Base path `/apx`; internal links absolute with trailing slash. Screenshots are placeholder `<Screenshot/>` components (files using it must be `.mdx`). GFM-in-MDX needs the explicit `remarkGfm` in `astro.config.mjs` — don't remove it. **Read `docs/AUTHORING.md` first.** Not wired into preflight — build explicitly (`cd docs && pnpm build`) when you touch it.
