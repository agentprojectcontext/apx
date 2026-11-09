---
title: "Moving an AI agent to another computer: a backup checklist"
description: "Plan an AI agent migration, check what a backup includes, and test the restore before relying on the new machine."
lang: en
slug: back-up-ai-agent-before-moving
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/back-up-ai-agent-before-moving/hero.webp
  alt: "Two computers connected by a line with a lock between them."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX move and backup documentation"
    url: "https://apxagent.app/docs/start/move-or-back-up/"
    checked: "2026-11-08"
  - label: "APX vs OpenClaw"
    url: "https://apxagent.app/compare/openclaw/"
    checked: "2026-11-08"
---

A working agent is more than an app installer. Its useful setup can include instructions, project files, conversations, schedules and access to outside services. Before replacing a computer or resetting an installation, find out which of those will actually travel with your backup.

## Make an inventory before you move

List the projects and folders the agent works in, its scheduled jobs, connected accounts and any conversations or data you need to keep. Identify the person responsible for each outside account. A backup of settings may not contain the project folders themselves, and an exported conversation may not include its attachments.

Keep the copy somewhere you control and protect it: even an export without passwords can contain sensitive project names, instructions or chat text. Follow your organization's rules for storage and retention.

## Check the restore, not just the download

Use the product's current instructions to restore onto a test computer or separate installation. Before enabling scheduled work, inspect the preview, restore the required project folders and reconnect only the services you intend to use. Test with a harmless request and confirm you can find the expected result.

If automation might email someone or change data, leave it off until you have checked its destination and whether the old installation is still running. Two active copies can otherwise produce duplicate work. Retain the original until you have checked the new setup and your permitted backup.

## What APX exports

[APX's backup guide](https://apxagent.app/docs/start/move-or-back-up/) describes an export from **Settings › Move or back up**, with optional chat text and table rows. Secret values, passwords and tokens are not included; you add needed values again on the destination. Project settings can travel, but the project folder itself must be copied or cloned separately if it is missing. Chats do not include their files.

The import preview identifies missing folders and keys. Channels and MCP servers arrive off; flows arrive off as drafts and need review before publishing. Some other settings have their own rules, so read the preview and the guide rather than assuming every switch will have the same state.

## Comparing alternatives

For any local agent, ask the same questions: what leaves the machine, what is excluded, can you inspect the import, and what starts automatically? The [APX vs OpenClaw comparison](https://apxagent.app/compare/openclaw/) links to product sources; it is a starting point, not a tested migration guarantee. APX publishes this article and has an interest in the comparison.
