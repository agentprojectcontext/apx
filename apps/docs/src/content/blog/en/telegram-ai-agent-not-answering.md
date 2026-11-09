---
title: "Why your Telegram AI agent may not answer"
description: "Check the running installation, bot pairing and message destination before reconnecting."
lang: en
slug: telegram-ai-agent-not-answering
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/telegram-ai-agent-not-answering/hero.webp
  alt: "Message bubbles connected to a laptop."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/channels/telegram/"
    checked: "2026-11-08"
---

A Telegram bot can appear in your chat list while the agent behind it is offline or waiting for a decision. Before deleting the connection or creating a second bot, find which part of the path is failing.

## Check the installation and channel

The [APX Telegram guide](https://apxagent.app/docs/channels/telegram/) says APX must be running on your computer or server: Telegram is a way to reach it, not a replacement for it. Check that the intended installation and channel show as connected, then look for errors or pending approvals in the app.

Make sure you are writing from the account paired as the owner. An unpaired person may receive a pairing request instead of an owner conversation. Never share a bot token or pairing code in a public chat, and only use a code from your own bot.

## Is the message in a group?

Groups are opt-in in APX. The guide describes adding the bot, allowing Telegram to deliver group messages and listing the group in APX. The room’s response mode also matters: a bot configured to answer when called need not reply to every message.

Send a harmless test and look for the actual answer in the intended conversation. If the task may already have sent or changed something, verify the destination before retrying. An online indicator alone does not prove a task completed.
