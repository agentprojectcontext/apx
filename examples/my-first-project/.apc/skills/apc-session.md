# apc-session

You are running inside an **APC (Agent Project Framework)** project. APC gives you persistent state — sessions, memory, and a coordination layer with other agents — that survives across runs.

The APX daemon has already created a session for this run. Its id is in the **APC Runtime Context** block at the bottom of your system prompt (look for `APC session id`). The filename is `.apc/agents/<your-slug>/sessions/<id>.md`.

## What you should do

### At the start of work

If you haven't been told what to do, read the latest session in `.apc/agents/<your-slug>/sessions/` so you know where things were left.

### During work

Save anything durable to memory (so future runs see it without you having to re-read transcripts):

```bash
apx memory <your-slug> --append "User confirmed the rate limit is 10/s, not 100/s"
```

Update the session status as you progress:

```bash
apx session update <session-id> --status "🔄 implementing X"
```

### At the end

Close the session with a one-line result:

```bash
apx session close <session-id> --result "Implemented X. Tests pass. PR #142."
```

If you can't run `apx` (sandboxed shell, no PATH), print the result on the **last line** prefixed with `APC_RESULT:`:

```
APC_RESULT: Implemented X. Tests pass. PR #142.
```

APX captures that line automatically and writes it to the session file.

## How another agent picks up where you left off

Tomorrow, an operator or a different runtime can run:

```bash
apx session resume <id>          # see frontmatter + path of your transcript
apx session resume <id> --summary --full  # super-agent summary + tail of the transcript
```

The session file links to your *external* transcript (Claude Code session jsonl, Codex log, etc.) so the next agent has the full context, not just the result line.

## Cross-runtime memory

If you discover a fact that's relevant beyond this session, append it to memory:

```bash
apx memory <your-slug> --append "<fact>"
```

That fact becomes part of the system prompt of every future run of this agent — across Claude Code, Codex, OpenCode, Aider, and any direct LLM call. Memory is the canonical channel for long-term knowledge.
