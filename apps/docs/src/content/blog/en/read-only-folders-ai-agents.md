---
title: "How to let an AI agent read another project without changing it"
description: "Give an agent reference material without treating a comparison folder as its workspace."
lang: en
slug: read-only-folders-ai-agents
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/read-only-folders-ai-agents/hero.webp
  alt: "A folder behind transparent glass."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/concepts/projects/"
    checked: "2026-11-08"
---

An agent may need to compare an old implementation with a new one. Copying both into its writable workspace can make it unclear which version is authoritative. Give it a specific reference folder and make the intended output location explicit.

## Separate reference from work

In the [APX projects guide](https://apxagent.app/docs/concepts/projects/), a project can register a read-only folder for its agents. The agent can read and copy material from it, but APX refuses writes it can see there. This is a protection enforced by APX, not an operating-system sandbox: the guide notes that a script constructing a path at runtime may not be caught.

## Try a bounded comparison

1. Choose a folder that contains only material the agent is allowed to read.
2. Ask for a report in the writable project, naming the reference as read-only.
3. Inspect the report and source links; check that the reference folder was not changed.
4. Remove access when the reference is no longer needed.

Read-only does not mean confidential from the agent or its model provider. Do not add a folder with sensitive records unless the agent and connected services are authorized to process them. Check the permission mode and the actual destination before any edit.
