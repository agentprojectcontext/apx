---
title: "Can an AI agent work from WhatsApp or Telegram? What to check first"
description: "Plan a chat-based agent workflow around identity, approval, delivery and privacy before connecting a messaging app."
lang: en
slug: ai-agent-chat-apps
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-chat-apps/hero.webp
  alt: "Glowing speech bubbles connected by a line."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX channels overview"
    url: "https://apxagent.app/docs/channels/overview/"
    checked: "2026-11-08"
  - label: "APX Telegram setup"
    url: "https://apxagent.app/docs/channels/telegram/"
    checked: "2026-11-08"
  - label: "APX WhatsApp setup"
    url: "https://apxagent.app/docs/channels/whatsapp/"
    checked: "2026-11-08"
---

A message to an agent can be a convenient way to check on work while you are away from your desk. It also brings a different problem: the system must distinguish your instructions from messages sent by customers, coworkers or strangers. Connecting a messaging app is the start of that design, not the end.

## Start with one safe use case

Choose a task with a clear outcome, such as asking for the status of a project. Decide who may ask, what data the answer may include and which actions require your confirmation. Test in a private conversation with non-sensitive material before allowing a shared room or an external contact.

## Check identity and approval

Do not assume that a displayed name proves who sent a message. Understand what identity evidence your messaging service provides and how your agent application handles uncertain or risky requests. Confirm where approval prompts appear and what happens if you do not answer. A connected channel should not silently turn every person in a room into an administrator.

## Check delivery, not just configuration

Send a test message in each direction. Verify the response appears in the intended conversation, inspect failed or uncertain delivery states and check whether retries can duplicate an external action. Room support, attachments and confirmation buttons may differ by service.

## How this works in APX

[APX's channels guide](https://apxagent.app/docs/channels/overview/) describes channels, contacts and rooms separately. It documents owner identity checks, approval options for new contacts and sealed contact conversations, as well as specific exceptions such as optional public web search. The guide says Telegram, WhatsApp and Signal identify the originating account; other channels have an additional super-agent check. Read the detailed policy before relying on it for sensitive work.

The [Telegram guide](https://apxagent.app/docs/channels/telegram/) and [WhatsApp guide](https://apxagent.app/docs/channels/whatsapp/) explain their different setup requirements. APX supports explicitly listed Telegram groups; its WhatsApp connection reads one-to-one chats and ignores groups. APX's overview also describes a durable outbox with sent, maybe sent and failed states. A “maybe sent” result deserves inspection before you send again.

## Before inviting anyone else

- Confirm which people and rooms can reach the agent.
- Verify how new contacts are approved and which capabilities they receive.
- Review what the agent may disclose and which actions require approval.
- Test a message, a reply and a failure path in your chosen channel.
