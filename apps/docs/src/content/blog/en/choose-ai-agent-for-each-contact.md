---
title: "How to choose which AI agent answers each contact"
description: "Choose who handles each conversation, review its permissions, and test the full message path before inviting contacts."
lang: en
slug: choose-ai-agent-for-each-contact
draft: false
published: "2026-11-21"
image:
  src: ../../../assets/blog/choose-ai-agent-for-each-contact/hero.webp
  alt: "A glowing signal branches towards two profiles against a dark blue background."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "Channels and contacts in APX"
    url: "https://apxagent.app/docs/channels/overview/"
    checked: "2026-11-21"
  - label: "OpenClaw multi-agent routing"
    url: "https://docs.openclaw.ai/concepts/multi-agent"
    checked: "2026-11-21"
  - label: "Proposed fix for OpenClaw account bindings"
    url: "https://github.com/openclaw/openclaw/pull/194089"
    checked: "2026-11-21"
---

An assistant can help you over WhatsApp or Telegram. But when a client, supplier or relative writes in, the question changes: who should answer, and under which instructions? You choose the account's default agent and any exception for a contact separately.

Before opening a channel, choose a default owner for conversations and write down the exceptions. A person asking about a project might need its project lead; another might stay with your main assistant. Then test each path with harmless messages and check who actually answered.

## One account, different conversations

Connecting a channel does not mean every contact needs the same response. Start with the purpose of each conversation: what the agent may share, which subjects it should avoid, and when you should step in. You do not need a different agent for everyone. Make an exception when the responsibility really changes.

Routing is not access control. Check who is approved to write, what happens when a new person contacts you, and whether a reply goes out automatically or waits for your review. For sensitive conversations, set clear boundaries and start with supervision.

## Why the destination needs testing

[OpenClaw documents](https://docs.openclaw.ai/concepts/multi-agent) rules for routing incoming messages to different agents, including by sender. APX is not alone in offering routing. Its configuration also shows why the saved result deserves inspection: a [fix proposed on November 6, 2026](https://github.com/openclaw/openclaw/pull/194089) describes a specific case where two Telegram bindings saved together produced a different configuration from the same bindings saved separately.

The contributor supplied configuration and readback evidence, not a real Telegram message test. It does not establish that every version is affected or that APX is immune to similar mistakes. The practical lesson is simpler: inspect the final setting and test the whole message path, not just the save button.

## Choosing a contact's agent in APX

The [channels guide](https://apxagent.app/docs/channels/overview/) distinguishes an account's agent for contacts from the choice for one person. In a contact chat, select the name to open the contact card. Under **Answers**, choose **Like the account** or **Another agent**. The latter offers your super-agent and your project leads, not every agent on the team.

The guide says a contact's own choice applies across their accounts and stays in place if you later change the account's contact agent. You can also set rules, mute the contact or enable **Supervise**, so you can review, edit or discard a reply before it is sent. Optional capabilities, such as answering from notes or taking orders, are configured separately; check those permissions before enabling them.

By default, a contact chat is sealed: its replies cannot use tools or your private memory. The documentation describes optional, limited capabilities you can enable. Do not assume every contact has the same access. For a closer look at review, see [how to review an agent's reply before sending](/blog/review-ai-agent-contact-replies/).

## A short test before you rely on it

1. Choose two test contacts and confirm each person's identity.
2. Leave one with the account's agent and assign the other a project lead.
3. Check both contact cards, permissions and supervision settings.
4. Send a harmless message from each test account. Check the panel's indicator for which agent handles the chat. If **Supervise** is on, review and approve the draft to send it; a discarded draft is not sent. Then check the receiving chat to confirm the reply reached the right person.
5. Check what happens with a new or muted contact too; don't assume they will receive an answer. If anything differs from your expectations, stop and inspect the settings before proceeding.

Test every channel you intend to use: a visible setting alone does not prove delivery. If delivery is uncertain, inspect the conversation before trying again.
