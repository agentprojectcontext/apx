---
title: "When an AI agent stops replying: a safe checklist"
description: "Safe checks to try when an AI agent stops responding, before resetting or repeating external actions."
lang: en
slug: ai-agent-stops-replying
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-stops-replying/hero.webp
  alt: "A glowing speech bubble with a pause symbol and a signal."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "OpenAI community discussion"
    url: "https://community.openai.com/t/1407313/1"
    checked: "2026-11-08"
  - label: "tasks with status and results"
    url: "https://apxagent.app/docs/office/tasks/"
    checked: "2026-11-08"
  - label: "memory controls"
    url: "https://apxagent.app/docs/concepts/memory/"
    checked: "2026-11-08"
  - label: "APX vs ChatGPT dots"
    url: "https://apxagent.app/compare/chatgpt-dots/"
    checked: "2026-11-08"
---

An agent can show a message as read while its work remains unfinished. Before restarting or deleting anything, check whether it is waiting for you, a service, or access to a connected tool. Preserve any information you need to recover the work.

## 1. Check for a pending decision

Look for approval requests, questions and task status in the app. Some agents pause before actions that need your permission. Answer only if you understand the action and intended recipient; otherwise decline or ask for clarification. A visible “ready” indicator may describe a connected computer, not the status of every task.

## 2. Check usage and service availability

Review the service status, plan limits and any error messages. A model provider or connected application may be unavailable even when the main app opens. Record the time, product version, platform and wording of the error; avoid including passwords, private conversations or credentials in a support report.

## 3. Protect the work before resetting

Read the product’s current recovery instructions and check what a reset or deletion removes. Save permitted copies of results and notes first. Don’t delete an agent or its memory as a generic troubleshooting step: it may not fix the underlying issue and could remove useful information. If the task involved money, email or another external action, check the destination before retrying so you don’t cause a duplicate action.

## 4. Contact support with a narrow report

Describe what you asked, what the app displayed and which safe checks you already tried. In an [OpenAI community discussion](https://community.openai.com/t/1407313/1), one user described a Dot that stopped responding after a pending decision; another later reported a similar symptom. These are user reports, not a diagnosis, a prevalence estimate or proof of the current state of the service.

## How to evaluate alternatives

Test the same harmless task in each product: ask it to produce a short report, pause for an approval and show where to find the result. Compare visibility, recovery, permissions and cost. APX documents [tasks with status and results](https://apxagent.app/docs/office/tasks/) and [memory controls](https://apxagent.app/docs/concepts/memory/); they do not guarantee that every task finishes or that the same failure cannot occur. See [APX vs ChatGPT dots](https://apxagent.app/compare/chatgpt-dots/) for a sourced comparison. APX wrote this article and has an interest in the comparison.
