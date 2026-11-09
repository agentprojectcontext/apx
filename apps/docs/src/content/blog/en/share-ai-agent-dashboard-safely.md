---
title: "How to share an AI agent dashboard without exposing your workspace"
description: "Check visible data, link access and hosting before sharing a widget."
lang: en
slug: share-ai-agent-dashboard-safely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/share-ai-agent-dashboard-safely/hero.webp
  alt: "A dashboard card with a sharing link."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/office/board/"
    checked: "2026-11-08"
---

A dashboard is easier to share than a long report, but a link can reveal more than its title suggests. Before sending it, inspect the entire view as the recipient would, including filters and cached or example data.

## Decide what the recipient needs

Remove customer names, internal links and private numbers that do not belong in the shared view. If a widget uses live data, understand which source updates it and whether the displayed information can change after you share it. Test with fictional data first.

The [APX board guide](https://apxagent.app/docs/office/board/) says artifacts are private by default and that anyone with an enabled share link can view the shared artifact. A link needs a reachable host; making one does not itself expose a loopback-only core. The guide also warns that enabling a public address can make already-shared pages reachable, so review existing shares first.

## Verify access and remove it later

1. Inspect the whole page and ask a trusted tester what they can see.
2. Enable only the intended share and send it to the intended audience.
3. Recheck the visible data after changes or refreshes.
4. Stop sharing when the link is no longer needed.

Do not expose the full control panel just to publish one view. Exporting a template without its saved memory is a separate choice from sharing a live view.
