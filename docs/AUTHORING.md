# APX docs — authoring guide

This Astro + Starlight site documents APX. **Every page must exist in two languages.** Follow this
guide exactly so all pages share one format and design.

## Where files go

- English (default locale) → `src/content/docs/<section>/<slug>.md(x)`
- Spanish → `src/content/docs/es/<section>/<slug>.md(x)`

Sections (sidebar groups, already configured): `start`, `concepts`, `surfaces`, `engine`,
`capabilities`, `reference`. The slug and folder must be **identical** in EN and ES (only the
content is translated) so Starlight links the two versions.

## Frontmatter (required on every page)

```yaml
---
title: Page Title
description: One-sentence summary (used for SEO + search).
sidebar:
  order: 1   # controls order within the section; lower = higher
---
```

Use `.md` for prose-only pages and `.mdx` when you use components (Steps, Tabs, Aside, Screenshot,
Card…).

## Internal links

Always absolute, always include the `/apx` base:

- EN: `/apx/<section>/<slug>/` — e.g. `/apx/concepts/agents/`
- ES: `/apx/es/<section>/<slug>/` — e.g. `/apx/es/concepts/agents/`

Trailing slash required. EN pages link to EN, ES pages link to ES.

## Screenshot placeholders (IMPORTANT)

Do **not** use real images. Use the shared `<Screenshot>` component for every screenshot. Import
path depends on folder depth:

- EN page (`src/content/docs/<section>/x.mdx`): `import Screenshot from '../../../components/Screenshot.astro';`
- ES page (`src/content/docs/es/<section>/x.mdx`): `import Screenshot from '../../../../components/Screenshot.astro';`

Usage:

```mdx
<Screenshot
  surface="web"
  caption="Web admin panel — project list"
  hint="apx web, then open the Projects rail" />
```

`surface` is one of: `web`, `terminal`, `tui`, `desktop`, `code`, `voice`, `deck`. Add a screenshot
wherever a real capture would help (every UI view, key terminal output, notable code/config). The
`caption` doubles as future alt text; `hint` is the exact command or screen to capture.

Any file using `<Screenshot>` (or any component) must be `.mdx`.

## Starlight components you may use

Import from `@astrojs/starlight/components`. Common ones:

- `<Steps>` — wrap an ordered `<ol>` of sequential instructions.
- `<Tabs syncKey="...">` + `<TabItem label="...">` — e.g. npm/pnpm variants.
- `<Aside type="tip|note|caution|danger">` — callouts.
- `<Card>` / `<CardGrid>` / `<LinkCard>` — landing-style grids.
- `<FileTree>` — directory layouts.

## Voice & format

- EN: concise, technical, second person ("you").
- ES: rioplatense (es-AR), "vos" not "tú". Keep commands, flags, file paths, and code in English/as-is —
  translate only prose. Mirror the EN structure section-for-section.
- Code blocks: always specify a language (`bash`, `json`, `text`, `yaml`).
- Verify every CLI flag before documenting it — run `node src/interfaces/cli/index.js <cmd> --help`
  (or `apx <cmd> --help`). Do not invent subcommands or flags.

## Reference page to copy the style from

`src/content/docs/start/installation.mdx` and `src/content/docs/start/architecture.mdx` are the
gold-standard examples. Match their tone, section depth, and use of components.

## Sources to study (don't guess)

- `README.md`, `AGENTS.md`, `CHANGELOG.md` at repo root.
- The bundled skills in `skills/<name>/SKILL.md` — these document each operation in depth
  (apx-project, apx-agent, apx-sessions, apx-mcp, apx-routine, apx-task, apx-telegram, apx-voice,
  apx-runtime, apx-agency-agents, apx-skill-builder, apx, apc-context).
- `src/` for ground truth: `src/core/`, `src/host/daemon/`, `src/interfaces/`.
- `spec/decisions/` and `spec/done/` for design rationale.
