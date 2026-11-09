---
title: "How to keep an AI agent’s project context useful over time"
description: "Organize project context and test what an AI agent recalls without assuming memory is perfect."
lang: en
slug: ai-agent-project-memory
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/ai-agent-project-memory/hero.webp
  alt: "Glowing folders connect to a network of small cubes."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "October 2026 Claude Code feature request"
    url: "https://github.com/anthropics/claude-code/issues/104704"
    checked: "2026-11-08"
  - label: "memory documentation"
    url: "https://apxagent.app/docs/concepts/memory/"
    checked: "2026-11-08"
  - label: "APX vs Hermes Agent"
    url: "https://apxagent.app/compare/hermes-agent/"
    checked: "2026-11-08"
---

When you return to a project after a week, you should not have to reconstruct every decision. But an agent that saves everything can be just as difficult to work with as one that remembers too little. The goal is not unlimited memory: it is useful, reviewable context.

## Separate the decision from the conversation

For each project, keep a short record of the current objective, constraints, decisions and the source of each decision. Store sensitive information only where you have decided it belongs. Keep temporary requests out of the long-term record, and correct old notes rather than assuming a later chat always overrides them.

There is no universal memory layout. In an [October 2026 Claude Code feature request](https://github.com/anthropics/claude-code/issues/104704), a user asked to disable or redirect the rule that adds every memory file to `MEMORY.md`, because it flattened their hierarchical organization and brought the index closer to its limit. It is one user’s request about a particular organization method, not evidence that Claude Code generally forgets or that the request remains unresolved forever. Check the current issue and product documentation.

## Run a small recall test

1. Check that the relevant memory function is enabled. Give the agent a harmless project preference and a reason, and ask it to save them.
2. Start a new conversation in the same project and ask a specific question that should use the preference.
3. Inspect the returned note or source if available. Correct the preference and repeat the question.
4. Record what was recalled, what was missed, and whether the correction appeared. Don’t put passwords or production secrets in the test.

If the correction does not appear, do not assume it was saved. A successful example does not guarantee recall in every later chat. Questions, scope, settings and the model can affect what is retrieved. For decisions with consequences, inspect the source before acting.

## How APX approaches it

APX’s [memory documentation](https://apxagent.app/docs/concepts/memory/) describes notes scoped to the person, project or agent, and controls for viewing and correcting them. It also describes optional automatic capture and retrieval settings. Automatic capture depends on the helper and eligible owner turns; it excludes some sources, including contacts, rooms and external sessions. The documentation explicitly notes that review reduces mistakes rather than guaranteeing perfect understanding.

For a longer comparison, see [APX vs Hermes Agent](https://apxagent.app/compare/hermes-agent/). Both document memory and delegation, so choose based on the workflow and verify it with the same task. APX publishes this article and has an interest in the comparison. If your main need is coding, also test the coding tool you already use rather than assuming another app is a drop-in replacement.
