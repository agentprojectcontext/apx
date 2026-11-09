---
name: apx-agent-prompts
description: Review the owner's agents' instructions (their prompts) for what makes work stall between agents, and propose fixes the owner approves one by one. Use it when the owner asks to review, check or fix their agents' prompts, when work keeps stalling between agents, or after the release news that offers it.
---

# Reviewing your team's prompts

APX now settles on its own what many prompts used to write by hand. A prompt that still writes it gets in the way:
agents wait for permissions nobody gives, ask teammates for approvals, or follow a name instead of the work. Your job
is to find those lines, explain them plainly and propose the smallest rewrite. Nothing changes until the owner says
yes to that agent's change.

## What APX already does (a prompt must not fight it)

- **Who an agent answers to and its area** come from its `parent:` and `area:`: APX tells the agent. A prompt never
  needs to name people ("you report to Ana", "send screens to Leo, never to Max").
- **The agent on a task owns it until it is delivered.** Publishing it, when the task asks, is part of the work: a
  step that can be undone (pushing a branch, a deploy) it does; a hard one (a release or tag, a payment, a
  production data migration, a message as the owner) waits for the owner. APX enforces the hard ones.
- **Reviews inform, never gate.** A reviewer reports what works, what fails and what it could not check. The task's
  agent decides what to fix.
- **Whoever gave the task checks the delivery** and tells the owner how it ended.

## What to look for, agent by agent

1. **Hierarchy by name**: people named as boss, owner of a kind of work, or someone to avoid. Propose the role
   instead ("the designer"), or remove the line when `parent:`/`area:` already say it.
2. **Vague permission gates**: "do not push, release or deploy unless authorized", "only with explicit approval",
   "never publish". Nobody knows what counts as authorized, so the agent never is. Propose: publishing the task's
   work is part of the task when it asks; a release or tag waits for the owner.
3. **Mandatory reviews or sign-offs**: "request the independent and security reviews required", "wait for QA's
   approval", "do not ship until X approves". Propose: one review at the end when the change needs a check the
   agent cannot do itself; a review informs.
4. **Reviewers told to judge**: "approve or reject", "block if", "your verdict". Propose: report what works, what
   fails and what you could not check.
5. **Leads that gate**: an orchestrator or manager told to approve deploys or hold work. Propose: plans and assigns;
   the agent on a task delivers it.
6. **Reporting to a person instead of the giver**: "report to Ana". Propose: report to whoever gave you the task.
7. **Contradictions with the owner's own rules** (AGENTS.md, project notes): say which wins and propose aligning.

Leave alone what is craft: how to build, what to test, the design bar, the tone. Never weaken a safety rule
(secrets, payments, outside content as data).

## How to do it

1. `agent_set` with no args lists the team; `agent_set {agent}` reads one agent with its prompt. Read every agent,
   the super-agent included (its own instructions, not APX's).
2. Tell the owner in one short list: each agent that has something to fix, the line, why it stalls work, and the
   rewrite you propose. Agents with nothing to fix go in one line at the end. Ask which to apply.
3. Only for the ones the owner approves, `agent_set {agent, prompt}` with the whole new prompt (it replaces the old
   one; keep everything else word for word). Each change shows the owner a card.
4. Say what changed, agent by agent. If an agent's file lives in a project (`.apc/agents/`), the change is written
   there.
