# APX docs

The documentation site for APX v2: Astro + Starlight, in English (`src/content/docs/`) and Spanish
(`src/content/docs/es/`). The front page is not a Starlight page: it is `src/components/home/Home.astro`, in the
site's look, with its words in `src/i18n/home.ts`.

It installs on its own, outside the pnpm workspace, so Astro stays out of everyone else's install:

```bash
cd apps/docs
pnpm install
pnpm dev          # http://127.0.0.1:4400
pnpm build        # static site in dist/ at the published base, / (DOCS_BASE and DOCS_SITE change it)
pnpm check        # fixture tests, EN/ES page/heading parity, built internal routes and fragments
pnpm preview      # preview the built site at http://127.0.0.1:4400/
pnpm shots        # retake every screenshot against a demo core (see below)
```

It is published at `https://apxagent.app/` (the repository's Pages custom domain, built by the Pages workflow on
`main`; `agentprojectcontext.github.io/apx/…` redirects there). The build also copies `scripts/install/install.sh` and `install.ps1` to the site's root,
so `<site>/install.sh` is the stable install URL; the older `/v2/install.sh` stays served beside it. `<base>docs/`
redirects to the first page.

## Website analytics

`AnalyticsConsent.astro` is shared by Home and the Starlight footer. Other full-document layouts must include it once. Its script loads GA4 only after explicit acceptance; no consent-mode pings are sent before that. It stores the choice locally, strips queries/fragments and referrers from page views, and disables advertising signals. Declining after acceptance clears analytics cookies and reloads to unload Google. Storage failures default to asking again.

Before deployment, disable **Enhanced measurement** for the website's GA4 stream in Analytics administration: automatic form, search and link measurement is not part of this integration. Keep the website property separate from application telemetry/Firebase. Never add administration credentials to the site. Website privacy is documented in `reference/website-privacy.mdx` and its Spanish counterpart.

`pnpm check` includes consent behavior tests. Runtime checks must cover Home and docs in both languages, no Google requests before acceptance or after decline, one tag after acceptance, persistence, revocation, keyboard access and mobile layout. A successful analytics network request does not prove ingestion; confirm reception separately in Analytics.

With the repository's root development dependencies installed and the built site preview running, run `node apps/docs/scripts/analytics.browser.mjs` from the repository root. `DOCS_TEST_URL` overrides the default preview address (`http://127.0.0.1:4321`), and `DOCS_TEST_OUTPUT` saves desktop/phone screenshots. This harness intercepts Google requests: it proves browser consent behavior, not Google ingestion or remote tag behavior.

## Writing a page

- Every page exists twice, with the **same path**: `src/content/docs/<section>/<slug>.mdx` and
  `src/content/docs/es/<section>/<slug>.mdx`. Sections: `start`, `concepts`, `office`, `channels`, `extend`,
  `devices`, `reference`.
- Frontmatter: `title`, `description` (one sentence), `sidebar.order`.
- Links are absolute and end in `/`: `/concepts/agents/` in English, `/es/concepts/agents/` in Spanish. The site's
  base is added at build time.
- English: short, concrete, second person. Spanish: rioplatense ("vos", "tenés"), same sections as the English page.
  Commands, flags, paths and code stay as they are. UI labels are written as the app shows them in that language.
- Sentence case for titles and headings ("Run a routine now", not "Run A Routine Now").
- Document what the code does today. Check commands with `apx <command> --help`; mark anything partial as such.
- Public-safe content only (rule 17): Acme, Northwind, `user@example.com`, `~/work/…`.

## Documentation impact and checks

Every feature and fix records a documentation impact assessment, including a specific reason when no docs change
is needed ([workflow](../../rules/WORKFLOW.md#documentation-impact-contract)). Compare instructions with the actual
source and release tag, not just news metadata. Update or create English and Spanish pages in the same change.

`pnpm check` runs after the build locally and in the Pages workflow. It checks page pairs and heading levels, then
literal internal links and fragment ids in built HTML under `DOCS_BASE` (default `/apx`). It does not check external
URLs, asset/download existence, screenshots, translation meaning or product behavior. For another base, use that
same `DOCS_BASE` for both commands. A passing check is not a guarantee that all documentation is correct.

## Components

```mdx
import { Aside, Steps, Tabs, TabItem, CardGrid, LinkCard, FileTree } from "@astrojs/starlight/components";
import Shot from "../../../components/Shot.astro";        // ../../../../ from an es/ page
import Terminal from "../../../components/Terminal.astro";
import Blob from "../../../components/Blob.astro";

<Shot name="tasks" alt="The Tasks screen with open tasks grouped by state" caption="Tasks, across every project" />
<Shot name="phone-home" alt="…" frame="phone" />

<Terminal command="apx status">{`✓ core  running  http://127.0.0.1:7440
• crew  Home + 3 agents`}</Terminal>
```

- `Shot` shows `src/assets/shots/<name>.webp` (light) or `<name>-dark.webp` (dark), whichever matches the theme the
  reader is in, in a window frame (`frame="phone"` for a handset, `"none"` for no chrome; `split` shows both cut on
  a diagonal). A name with no file yet shows a dashed placeholder.
- `Terminal` colors output lines by their first mark: `✓` green, `✗` red, `⚠` yellow, `#` dim, `•`/`→` accent.
- `Blob` draws a blobo (`name="menta"`, `size={40}`); its eyes follow the pointer on every page.

## Screenshots

`scripts/shots.ts` starts a separate core (its own temp home, port 7480, file secrets, a scripted model that answers
like the demo crew), seeds an office ("Acme Store" with Lucía, Tomás and Vera), and captures each screen of the
panel in English, once per theme (Spanish pages reuse them). It runs with its own HOME and a `tailscale` that is not
logged in, so nothing of the machine it runs on (paths, browser profiles, tailnet names) ends up in a capture. It needs the panel built (`pnpm build:web` at the
repo root) and Playwright's Chromium (`pnpm exec playwright install chromium` at the root). The list of shots is in
the script; add one there and run `pnpm shots` again.
