---
title: "How to write a reusable AI agent skill"
description: "Turn a repeated task into a reusable skill without confusing instructions, permissions and proof of success."
lang: en
slug: ai-agent-skill-checklist
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-skill-checklist/hero.webp
  alt: "A small robot surrounded by blocks and a checklist."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX skills"
    url: "https://apxagent.app/docs/extend/skills/"
    checked: "2026-11-08"
  - label: "APX autonomy and safety"
    url: "https://apxagent.app/docs/concepts/autonomy/"
    checked: "2026-11-08"
---

Repeating the same detailed instructions every week is tedious. Copying a long prompt into every conversation also makes corrections easy to miss. A reusable skill gives the agent one place to find a procedure, but it still needs a clear trigger, safe boundaries and a way to check the result.

## Start with a task you actually repeat

Suppose you prepare a weekly status report. Write down the inputs, the period covered, the format and what to do when information is missing. “Summarize the week's closed tasks by project; identify blockers separately” is more useful than “be a great project manager.” Test with ordinary sample data before adding customer details.

## Make the skill discoverable

[APX skills](https://apxagent.app/docs/extend/skills/) are folders containing a `SKILL.md`. Its description tells an agent when the skill applies; the body holds steps and examples. In APX, project skills are available to that project's agents, while projects inherit global skills unless they turn them off. Agents still need to select and load the skill for a particular task; a saved file alone does not prove it was used.

A concise checklist might cover:

1. **Trigger:** when should this procedure be used, and when not?
2. **Inputs:** which source and date range should be checked?
3. **Steps:** what should the agent do, in what order?
4. **Output:** which sections, links or files should it produce?
5. **Exceptions:** what must be reported if a source is unavailable?
6. **Verification:** what evidence would show the job is complete?

## Keep permissions separate

A skill is instructions, not a permission grant. Review the agent's [autonomy and safety settings](https://apxagent.app/docs/concepts/autonomy/) before connecting services or sending messages. Do not place passwords or API keys in the skill. Review imported skills and their accompanying files before using them; readable instructions can still be wrong or unsafe.

## Improve it with real examples

Run the same task with the skill and inspect the sources and result. Note what required correction, update the procedure and test again using a different example. A useful skill reduces repeated explanation; it does not guarantee that the model follows every step or that its conclusions are correct.
