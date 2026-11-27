---
title: "How to monitor AI subagents when status details disappear"
description: "Tell a missing metric from a stalled AI subagent. Check background work, record the last confirmed activity, and decide when to intervene."
lang: en
slug: monitor-ai-subagents
draft: false
published: "2026-11-26"
image:
  src: ../../../assets/blog/monitor-ai-subagents/hero.webp
  alt: "A supervisor checks the activity of small robots at a workbench."
  caption: "Editorial illustration, not a screenshot."
sources:
  - label: "Claude Code issue #109446: custom subagent status line removal"
    url: "https://github.com/anthropics/claude-code/issues/109446"
    checked: "2026-11-26"
  - label: "Claude Code v2.1.323 release notes"
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.323"
    checked: "2026-11-26"
  - label: "Claude Code: customize the session status line"
    url: "https://code.claude.com/docs/en/statusline"
    checked: "2026-11-26"
  - label: "Claude Code: report follow-up and AgentRow"
    url: "https://github.com/anthropics/claude-code/issues/109446#issuecomment-6974969743"
    checked: "2026-11-26"
  - label: "Claude Code: session commands"
    url: "https://code.claude.com/docs/en/commands"
    checked: "2026-11-26"
  - label: "APX: watch an agent work in chat"
    url: "https://apxagent.app/docs/office/chat/#talking-to-an-agent"
    checked: "2026-11-26"
  - label: "APX: requested and reported models in external sessions"
    url: "https://apxagent.app/docs/concepts/models/#see-an-external-sessions-model"
    checked: "2026-11-26"
---

Three background agents are running. After an update, one row says only “Running grep.” The context, cost and model details you used to see are gone. **Don't restart the batch just to get those numbers back.** First check whether the worker stopped or the interface simply stopped reporting the details you need.

## Claude Code changed the row, not necessarily the work

On November 13, 2026 (UTC), a Claude Code user [reported that their custom subagent row stopped rendering](https://github.com/anthropics/claude-code/issues/109446) after upgrading from 2.1.322 to 2.1.323. The [2.1.323 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.323), published November 12 (UTC), confirm that `subagentStatusLine` was removed. Existing settings files with the key still load, and the rows use the default appearance. The issue was still open when checked on November 26. That's a confirmed change to a display setting and a user's account of what they lost, not proof that background work stopped or that every version shows the same fields.

In a [November 18 follow-up](https://github.com/anthropics/claude-code/issues/109446#issuecomment-6974969743), the same user said they got their custom rows back in 2.1.327 using an `AgentRow` mod. Some per-agent cache details were still unavailable. The workaround restored the display, not every metric.

Don't confuse the removed setting with `statusLine`. The [documented main session status line](https://code.claude.com/docs/en/statusline) takes session data. Refreshing it periodically may keep a clock or branch indicator current; it does not make parent-session numbers a reading for each child agent.

## Separate state, activity and resource use

- **State: is the worker still running?** Check its task state for a pending decision or a final result. A static row alone doesn't mean it's stuck.
- **Activity: has it made progress?** Look for the latest step or intermediate result you can verify, with a timestamp. “Running” doesn't say how much work remains.
- **Resource use: which model ran, and what did it cost?** Look for a report scoped to that worker or turn, with a unit and time window. The requested model isn't confirmation, and an absent cost isn't zero.

“Running; last step at 14:03; spend unknown” is a better report than “running normally.” Keep the scope with every number. If you only get a session or account total, label it that way rather than dividing it among workers.

## Make the next intervention predictable

1. **Choose one harmless test.** In a scratch project, give a background agent one read-only job, such as counting headings in two sample files. Note the installed version, start time and expected result. Watch the worker's own record as well as the coordinator's view. In Claude Code, [`/tasks`](https://code.claude.com/docs/en/commands) lists background work for the session.
2. **Agree on an observable checkpoint.** For longer work, ask for a small intermediate artifact or a short status update that names the last completed step and any blocker. Decide when you will check it rather than polling continuously.
3. **Escalate only on evidence.** If a checkpoint passes without fresh activity, look for an approval, a terminal result or a tool error before starting a replacement. If the task may have written files or sent something, check the destination before rerunning it. A blind retry can duplicate work.
4. **Set limits where you can enforce them.** If you're missing per-worker spend, reduce concurrency in the next trial and use a provider- or account-level limit where available. Don't rely on an unreliable display to enforce a budget. For earlier setup steps, see [how to define a clear agent handoff](../ai-agent-task-handoffs/).

## Put this into practice in APX

In an APX agent chat, turn on **Show tools** and expand the steps: [the chat shows tool activity and delegations recorded by APX](https://apxagent.app/docs/office/chat/#talking-to-an-agent). Use that as evidence of activity and check the resulting file or reply before calling the job done.

For [external coding sessions](https://apxagent.app/docs/concepts/models/#see-an-external-sessions-model), the header shows the model you requested; the response footer shows the model reported by the engine, or **Model unconfirmed** when APX hasn't received it. That is evidence for the response, not a live reading of each subagent's tokens, cache or bill. APX doesn't restore Claude Code's removed setting. Keep unavailable telemetry marked as unknown and make decisions from the worker evidence you can actually inspect.
