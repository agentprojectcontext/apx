---
title: "AI agent permissions: how to decide what needs approval"
description: "Use a practical permission checklist to give an AI agent useful work without losing sight of consequential actions."
lang: en
slug: ai-agent-permissions-checklist
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-permissions-checklist/hero.webp
  alt: "A row of translucent doorways leads to a glowing open door."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX autonomy and safety"
    url: "https://apxagent.app/docs/concepts/autonomy/"
    checked: "2026-11-08"
  - label: "APX vs Instinct"
    url: "https://apxagent.app/compare/instinct/"
    checked: "2026-11-08"
---

An agent that can research, change files and send messages can be helpful, but those actions do not carry the same risk. Reading a public page is different from sending a customer message or deleting a folder. The right question is not simply whether an agent is autonomous: it is which actions it can take, where, and when you can intervene.

## Start with the action, not the label

List the actions a task actually requires. For a weekly report, that might mean reading a project folder, gathering public information and preparing a draft. Sending it to a client is a separate action. Check the recipient, content and attachments before allowing a send; a good draft does not prove it reached the right person.

Also identify irreversible or expensive actions: payments, deleting information, publishing and changing external accounts. A system can ask for approval for some actions while permitting others automatically. Read its current rules rather than assuming that a mode with a familiar name means the same thing across products.

## Treat outside content as data

A page, email or document can contain instructions addressed to an agent. Its usefulness as a source does not make it your instruction. When evaluating a product, ask how it handles this distinction and which actions need confirmation after it reads external material. Never place passwords in prompts just to make an agent finish a task.

## Try a harmless approval flow

1. Give the agent a small, non-sensitive task and specify the expected output.
2. Ask it to attempt an action that requires approval under your chosen settings, using a safe test destination.
3. Inspect what the approval says: recipient, action, destination and consequences should be clear enough to decide.
4. Decline if it is wrong or unclear, then check that the action did not occur. Test only within an environment where an accidental action would be safe.

One successful test is not a security audit. Revisit permissions when you add integrations or change the work.

## In APX

[APX documents five permission modes](https://apxagent.app/docs/concepts/autonomy/). Its Auto mode describes approval for strong actions such as sending or paying; Total is a broader choice, with some settings still requiring explicit approval. The guide also describes per-action rules and grants. Check the current guide and the actual approval card: settings, grants and the precise action matter.

The [APX vs Instinct comparison](https://apxagent.app/compare/instinct/) links to the respective product sources. A documented feature comparison is not proof that either product is immune to mistakes. APX publishes this article and has an interest in the comparison.
