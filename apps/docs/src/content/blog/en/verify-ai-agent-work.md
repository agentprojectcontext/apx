---
title: "How to verify AI agent work before calling a task done"
description: "Use completion criteria, evidence and a small review loop to distinguish a polished answer from finished work."
lang: en
slug: verify-ai-agent-work
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/verify-ai-agent-work/hero.webp
  alt: "A magnifying glass over a checklist."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX tasks"
    url: "https://apxagent.app/docs/office/tasks/"
    checked: "2026-11-08"
  - label: "APX agents"
    url: "https://apxagent.app/docs/concepts/agents/"
    checked: "2026-11-08"
  - label: "APX autonomy and safety"
    url: "https://apxagent.app/docs/concepts/autonomy/"
    checked: "2026-11-08"
---

A confident answer is not the same thing as a completed task. An agent can summarize a document it never checked, report a change that did not reach the intended destination, or finish only one part of a request. The remedy is not to read every internal step: agree on a result and inspect evidence appropriate to that result.

## Define completion before starting

For a research brief, completion might mean five accessible sources, a date for each and a summary that distinguishes facts from interpretation. For a file edit, it might mean the correct file exists and its contents have been read back. For a website, it might mean the public page loads and shows the intended change. These are examples, not automatic guarantees.

Write down the expected location, constraints and who reviews it. In [APX tasks](https://apxagent.app/docs/office/tasks/), a goal describes what the person will check; the task also keeps discussion and progress. Assigning a task starts work, but assignment itself is not evidence of success.

## Ask for evidence matched to the job

- **Research:** open the sources and compare the actual text with the claims. A link alone is not proof.
- **Files:** read back the intended file and confirm its location and contents.
- **Software:** inspect the change, run relevant tests and exercise the changed behavior where feasible. A passing test does not prove every path works.
- **Publication:** open the public destination, not just the draft. Check the title, language and links.
- **Communication:** inspect the send result and the destination; a prepared draft is not a sent message.

If a step could not be checked, label it unverified rather than filling the gap with a confident summary.

## Use a review loop, not endless delegation

Give the implementer a bounded result and ask a reviewer to check the finished change against its criteria. The [APX agents guide](https://apxagent.app/docs/concepts/agents/) describes distinct roles and handoffs; the reviewer's judgment still needs suitable evidence. For sensitive or irreversible actions, inspect the applicable [permission settings](https://apxagent.app/docs/concepts/autonomy/) and make the decision yourself when required.

A useful final report says what changed, what was checked, where the evidence is and what remains uncertain. Only call the task done when the outcome—not just the agent's response—meets your criteria.
