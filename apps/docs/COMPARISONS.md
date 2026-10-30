# Product comparisons

The comparison index is at `/compare/`, with Spanish parity at `/es/compare/`. Individual pages are generated from `src/data/comparisons.ts` using the shared `src/components/compare/ComparePage.astro` template. Home and all comparison pages share the actual web header and footer from `src/components/web/`, including the index link. The shared footer includes the official [APX YouTube channel](https://www.youtube.com/@apx-agents) alongside GitHub and Discord as labeled social icons. Its brand summary and social icons sit to the left of four link columns on desktop; copyright, macOS/Windows/Linux/Android availability and “Made with ♥ in Argentina” sit below a divider. On mobile the columns become a two-column grid and the lower items stack. Both layouts are available in English and Spanish. Documentation is separate under `/docs/` and `/es/docs/`; see [Site routing](SITE_ROUTING.md).

## Editorial contract

- Compare documented workflows, not inferred absences or universal quality scores.
- Keep a meaningful reason to choose either product.
- Check primary project documentation and licenses before editing the review date. The date records source review, not a product benchmark.
- Keep every row and section in English and Spanish. Add only products with sufficient verified sources; the current first set is Hermes Agent, OpenClaw and OpenBot.
- Logos identify third-party products; provenance is in `public/brands/README.md`.
- Do not treat provider charges, software licenses and hosted-service costs as the same thing.

## Source snapshots and home discovery

Consulted on 2026-10-30. GitHub document and license citations are pinned to verified commits in `sourceSnapshots`: APX uses the reviewed website base `61e82f790c1e4802a8f4e1764ae5ccc86487d3fe`, Hermes `5057eaa3a4d0cbef0e30078418a5115faa62889e`, OpenClaw `b277db00687aabbf245c0d9287139a30bb2a22df`, and OpenBot `98e89b61782a2ae7d0aac380d82d824b65179afd`. Each README and license returned HTTP 200 at that revision. Repository landing pages are discovery links, not immutable evidence.

The web sources remain variable: `https://openbot.run/`, `https://openbot.run/compare/hermes-agent`, `https://docs.openclaw.ai/concepts/multi-agent` and `https://docs.openclaw.ai/automation/cron-jobs`. Their consultation date does not freeze their content. Dated excerpts from a fresh consultation are preserved in [Mutable web source evidence](COMPARISON_WEB_EVIDENCE.md); this record explicitly distinguishes publisher claims from exercised functionality. Recheck them before changing claims or the review date. License wording preserves possible exceptions: uses outside the listed permissions **may** require separate permission; it does not decide fair use or give legal advice.

Home includes `#questions`, six native disclosure controls with links to supporting documentation, followed by exactly three comparison cards with local logos and APX blobs. Copy lives in `src/i18n/home-discovery.ts`; the questions link is shared across web pages. No JavaScript is required for the accordion or cards. `e2e/preview/docs/home-discovery.spec.ts` covers both languages, phone/desktop, themes, keyboard operation, loaded logos, comparison links and no-script behavior.

Docs impact: updated — bilingual comparison maintenance notes and home discovery navigation.

## Verification

From this directory:

```sh
pnpm install --frozen-lockfile
DOCS_BASE=/ DOCS_SITE=https://apxagent.app pnpm build
pnpm check
pnpm exec astro preview --host 127.0.0.1 --port 4410
```

From the repository root, with root development dependencies installed:

```sh
pnpm exec playwright test --config e2e/docs-comparisons.config.ts
```

The browser suite uses the built site, tests three products in two languages at desktop and phone widths, checks local image loading, source links, language round-trips, comparison navigation, scroll-driven active sections, keyboard navigation and horizontal overflow. It saves hero, table and sources screenshots in `test-results/docs-comparisons/`. It does not independently establish the truth of editorial claims; a source review is also required.

The reading constellation uses native fragment links and progressive enhancement. With JavaScript disabled, links still navigate to sections; active scroll tracking requires JavaScript. Without JavaScript no section is marked current; scripts set the active section only after measuring the page. Comparison tables retain native table display and column/row headers on phones, with a labeled, keyboard-focusable horizontal scroll region rather than block-stacked cells. Reduced-motion settings disable smooth scrolling. Below desktop width, navigation is in document flow rather than an overlay.

Editorial evidence is linked beside each table cell, not only from a generic project link. The APX platform row explicitly includes Android, without implying a native iOS app. Hermes agent hosting is distinct from command-execution backends. OpenBot scheduling and chat channels are stated symmetrically, and its license description defers to the permitted purposes in PolyForm Noncommercial 1.0.0 rather than classifying every commercial context. Logo provenance is recorded in `public/brands/README.md`; trademark permissions have not been verified.

Docs impact: updated — new bilingual comparison pages and home-footer entry point. No core, protocol, permissions, state or release behavior changes.
