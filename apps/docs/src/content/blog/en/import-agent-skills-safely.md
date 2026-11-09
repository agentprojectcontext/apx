---
title: "How to inspect an AI agent skill before importing it"
description: "Review instructions and bundled files before adding a reusable procedure."
lang: en
slug: import-agent-skills-safely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/import-agent-skills-safely/hero.webp
  alt: "A folder with a download symbol and magnifying glass."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/extend/skills/"
    checked: "2026-11-08"
---

A skill can save you from repeating a procedure, but an imported folder may contain more than the short description in a catalog. Treat it like software or instructions from an outside source: inspect it before giving an agent work that uses it.

## Inspect what is actually included

The [APX skills guide](https://apxagent.app/docs/extend/skills/) describes importing from a folder, archive or repository. APX first lists the skills, files and scripts it found and what was omitted; the import preview runs nothing. Read the instructions and supporting files, and check whether the source and task scope make sense.

Look for commands that delete files, contact outside services or request credentials. A skill is not a permission grant. Do not paste secrets into its files, and do not assume a familiar-sounding name means the procedure has been reviewed.

## Test on disposable material

Choose a harmless sample in a project meant for testing. Ask the agent to explain which skill it loaded and inspect the generated result and any actions it proposes. Compare the output against the original source, then fix or stop using the skill if it behaves unexpectedly.

A project copy and a global skill have different reach. Review where the import will be installed and which agents can use it. Repeat the review when you update the source or import a different version.
