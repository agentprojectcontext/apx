# Group chats of several agents

**Status: a proposal** ([D-209](DECISIONS.md#d-209)), with a prototype behind `APX_GROUP_CHATS=on` (off by default).
Nothing here is accepted yet: the owner decides.

The owner wants a chat with two to five agents and themselves, and later Slack-like rooms with many agents where only
the one or two who matter answer. Done naively, every agent re-reads the whole conversation on every message, so the
cost grows with agents × messages × everyone's work. This page measures the ways to run such a chat and recommends one.

## What APX already does

- **Delegation reads answers, not work.** An agent that asks a teammate (`threads.send` into an `a2a` sub-thread) gets
  back only its answer, as a `delegation_result` envelope; the teammate's tool steps stay in its own chat (D-071,
  D-194). This is already the owner's "back chat": closed, one hop.
- **Rooms read a window as data.** A Discord channel or Telegram group (`channels/rooms.ts`, `roomInput`) keeps every
  message, and a turn reads the latest 25 (6,000 characters) as untrusted data instead of a history; whether the agent
  speaks at all is decided first by the mode, a mention, and in "useful" rooms a cheap model's yes or no.
- **History is cut and pruned.** A chat's history is the newest 120,000 characters (`HISTORY_BUDGET_CHARS`), and
  tool output older than the newest two runs is a stub (`FULL_OUTPUT_RUNS`, `pruneOutput`).
- **The prefix is cached.** The system prompt is byte-stable per chat ([PROMPT_SIZE.md](PROMPT_SIZE.md)), so providers
  read it from their prompt cache from the second call on. Its first line is the agent's name, so two agents share
  no cached prefix.

## Outside approaches

| Approach | What each agent reads | Who speaks | Fit for APX |
|---|---|---|---|
| AutoGen `GroupChat` / `SelectorGroupChat` | one shared thread, every message broadcast to all | round robin, or an LLM selector over roles and history | the selector fits; the broadcast is the cost the owner fears |
| LangGraph supervisor | the supervisor sees either each worker's full history or only its last message (`output_mode`) | the supervisor routes | the "last message" mode is the front/back split |
| CrewAI hierarchical | a task's description plus earlier tasks' outputs | a manager model delegates | outputs only, like APX's delegation |
| MetaGPT shared message pool | only the message types each role subscribes to | publish/subscribe | the many-agent room's shape: read what concerns you |
| Blackboard / rolling summary | a shared summary plus the latest lines | any | bounded cost, but a summary loses facts and breaks the cache each time it changes |
| Provider prompt caching (Anthropic, OpenAI, Gemini) | — | — | only a byte-identical prefix is cheap (a tenth to a quarter of the price); anything that rewrites the start of a prompt pays in full |

What they share: the cost lever is not the transcript format but **how many agents run per message** and **whether
each one's prompt only grows at its end**.

## Mechanics compared

Each replays the same script: the owner and four agents (a coordinator, an engineer, marketing, finance) plan a
launch; 16 owner messages, 11 of them followed by tool work with canned results (findings plus ~3,000 characters of
search-like lines), the last three asking for facts given earlier (`scripts/group-chat-bench.scenario.json`).

| Mechanic | What an agent reads | Who answers |
|---|---|---|
| `shared-all` | one transcript: every message and every agent's tool steps (others' as data) | every agent |
| `shared-router` | the same transcript | the agents a cheap router call picks (an `@mention` skips it) |
| `split-all` | the front chat (owner and answers) plus only its own work | every agent |
| `split-router` | front + own work | router |
| `split-router-shared` | as `split-router`, with the agent's name moved after the prefix all agents share, and one cache key for the room | router |
| `summary-router` | a rolling summary (a cheap call every four messages), the latest six lines and its own work on this message | router |

All of them keep the core's rules: the 120,000-character history budget, tool output past the newest two runs as a
stub, other agents' words never as the `assistant` role. Each agent's prefix is APX's real system prompt and tool
definitions captured from a scratch core (5,812 + 24,094 characters, about 7,800 tokens); in a real turn the tools are
sent as definitions, here as text, so the replay answers without calling them.

## Measured

`pnpm bench:group-chat` (`scripts/group-chat-bench.ts`), 2026-11-08. "Billed" is input as a provider charges it when a
cached token costs a quarter (Gemini) or a tenth (Anthropic, OpenAI) of a fresh one.

**A real model** (`openai/gpt-4.1-nano` through OpenRouter, one tool step per piece of work, 16 messages):

| Mechanic | Calls | Input | Cached | Billed (¼) | Billed (⅒) | Output | s/message | Router exact | Facts missed |
|---|---|---|---|---|---|---|---|---|---|
| shared-all | 64 | 627,932 | 549,504 | 215,804 | 133,378 | 2,726 | 4.1 | — | 0/24 |
| shared-router | 32 | 161,751 | 113,920 | 76,311 | 59,223 | 1,018 | 1.8 | 13/16 | 1/6 |
| split-all | 64 | 599,799 | 567,168 | 174,423 | 89,348 | 2,898 | 3.8 | — | 4/24 |
| split-router | 32 | 151,534 | 114,560 | 65,614 | 48,430 | 1,178 | 1.9 | 14/16 | 0/6 |
| split-router-shared | 32 | 150,702 | 120,832 | 60,078 | 41,953 | 1,042 | 1.8 | 14/16 | 0/6 |
| summary-router | 40 | 151,606 | 122,752 | 59,542 | 41,129 | 4,354 | 2.3 | 14/16 | 1/6 |

The run cost USD 0.08 in all. Router misses: "what do you all think?" went to the coordinator alone (the router's
prompt now says to pick everyone for that), and once a hosting question went to finance.

**Longer and heavier chats** (`--dry`: no model; the prompts each mechanic builds, measured at four characters a token,
with an ideal prefix cache from 1,024 tokens; on the run above it reads about 20% high, with the same shape). Four tool
steps per piece of work, the script repeated:

| Mechanic | 16 messages, billed (¼) | 32 messages | 96 messages | Cached, 96 | Last call, 96 |
|---|---|---|---|---|---|
| shared-all | 373,412 | 846,558 | 5,994,172 | 63% | 37,765 |
| shared-router | 202,881 | 408,909 | 1,817,392 | 64% | 37,541 |
| split-all | 268,292 | 606,539 | 4,160,358 | 78% | 38,160 |
| split-router | 135,016 | 262,625 | 933,202 | 84% | 26,982 |
| split-router-shared | 116,380 | 244,073 | 914,890 | 85% | 26,986 |
| summary-router | 116,983 | 229,902 | 682,542 | 71% | 9,029 |

**The heavy chat on a real model** (`gemini-3.5-flash-lite`, free tier, four tool steps per piece of work, 32 messages;
Gemini caches on its own, in large blocks, so its cache rates are lower than the ideal one):

| Mechanic | Calls | Input | Cached | Billed (¼) | Billed (⅒) | Output | s/message | Router exact | Facts missed (asked agent) |
|---|---|---|---|---|---|---|---|---|---|
| shared-all | 128 | 2,210,218 | 1,651,181 | 971,832 | 724,155 | 7,519 | 6.1 | — | 4 |
| shared-router | 70 | 703,724 | 361,670 | 432,472 | 378,221 | 3,639 | 2.4 | 30/32 | 0 |
| split-router-shared | 70 | 503,321 | 302,303 | 276,594 | 231,248 | 2,876 | 2.3 | 30/32 | 0 |
| summary-router | 86 | 434,267 | 22,347 | 417,507 | 414,155 | 8,983 | 3.1 | 30/32 | 1 |

The split bills 36% less than the shared transcript with the same router and 3.5× less than the naive group chat. In
the naive one the agent asked lost facts twice per round (the engineer the region, the coordinator the break-even),
in a transcript full of four agents' tool output. The rolling summary's prompt start changes with each summary, so
Gemini cached almost none of it. With the router's prompt telling it to pick everyone when the owner asks the whole
group, its only misses were a question to marketing that the script also meant for finance. (The split's two
"missed" facts in the raw file are "Fráncfort", the region spelled in Spanish: the keyword check, not the agent.)

## What the numbers say

1. **Who answers is the biggest lever.** Everyone answering every message costs 3–6× a router's pick, from the first
   message on, and adds noise: of the four answers to "Iris, set up a plan", three added nothing (waiting for the
   plan, or promising the same plan). The router call itself is about 500 tokens.
2. **The split matters once turns do real work and the chat gets long.** With one short tool step, APX's own pruning
   already hides old tool output and the split saves 10–20%. With four steps per turn the split halves the bill at 96
   messages (1.82M → 0.93M projected; 432k → 277k measured at 32), because the shared transcript fills its window with
   teammates' newest tool output and, as that window slides, its prompt cache breaks (64% cached against 84%).
3. **A shared prefix across agents is a small, free gain** (about 8% more cached) when the agent's name moves after
   the part every agent shares and the room uses one cache key. It changes the system prompt's order, so it is left
   for a later, measured change of its own.
4. **A rolling summary is smallest and bounded, but forgets and caches badly.** It lost the hosting region in one
   real run and the seat cap in another, and each new summary rewrites the prompt start: on Gemini it billed as much
   as the shared transcript. It belongs to the many-agent room, not to a
   five-agent group.
5. **The front/back split keeps what matters.** An agent's memory of the group is the answers, and every fact the
   script checks later was in an answer, so each one reached the agent asked (the `split-all` misses are two agents
   not asked, who only agreed). The shared transcript did worse once: asked for the hosting cost, the engineer gave
   finance's monthly burn (4,340 USD) instead of its own 1,240: one sample, but the kind of mix-up a transcript full of
   everyone's numbers invites.

## Recommendation

**Front/back split with a router** (`split-router`), as prototyped:

- The group's chat holds only the owner's words and each agent's final answer.
- Each member works in a closed chat of its own under the group (an `a2a` sub-thread, like a delegation). Its turn
  reads what the group said since its last turn, framed as the team's words; its history grows with answers and its
  own work, never with a teammate's tool steps, and only at its end, so its cache holds.
- Who answers: the members an `@mention` names; otherwise one cheap model call (the auxiliary model, as a room's gate)
  picks the fewest needed, everyone when the owner asks the whole group; with no auxiliary model, the first member.
  Answers come one after the other, so the second reads the first.

Measured on Gemini over 32 heavy messages it billed 28% of the naive group chat and 64% of a shared transcript with the
same router; projected to 96 messages, 15% and half.

## The prototype

`APX_GROUP_CHATS=on` turns it on; nothing changes for a core without it.

- `threads.group` `{agent_ids (2–5), title?}` makes a chat of kind `group` (the panel already shows a group: faces,
  each message's speaker). Owner-only.
- `threads.send` into it posts the owner's words in the group and starts the chosen members in line
  (`engine/group.ts`); the result's `run` is the turn answering now. It takes queued text only (no files, no steer).
- A member's turn is a normal run in its own chat: tools, memory, permissions, caching and the prompt budget are the
  core's own. The input adds one `[group chat]` line on its first turn there (about 60 tokens) and, each turn, the
  group's lines since its last one (answers capped at 4,000 characters, the newest 40 messages).
- When a member's turn ends its answer is posted in the group (`afterRun`), then the next in line starts; a failed
  turn leaves a one-line note instead. What the owner writes while a member works reaches that member's next turn. A
  turn a restart resumes keeps its place; one cut off and not resumed frees the line. `threads.cancel` on the group
  empties the line and stops the member answering.
- The router's calls count as the auxiliary model's "room" purpose in Usage.
- Tests: `apps/core/src/engine/group.test.ts` (the second member reads the first's answer and never its tool steps;
  an `@mention` skips the router; a member's next turn brings only what is new; words written while a member works
  reach its next turn; a failed turn leaves a note and the next member answers; no flag, no group).
- Tried on a scratch core with Gemini (2026-11-08): "Theo and Mara, in one line each…" went to both (3.8 s), "@mara one
  line for the landing page" to Mara alone without a router call (2.0 s), "Thanks!" to the first member (2.7 s); each
  worked in its own chat under the group. Not looked at in the panel yet.

Not in the prototype: a member asking another member directly (it is an `a2a` chat, so it names the teammate instead,
as a delegate does; the owner or an `@mention` asks them), streaming the answer into the group while it is written,
files, the panel's composer for making a group, and channels.

## Toward rooms with many agents

The same split scales to a room of many agents if the router does the work a room's gate does today:

- **Pick before anyone runs.** One router call per message over the roster (name, role, a line of what each knows)
  and the room's latest lines; the agents not picked cost nothing. An `@mention` is a pick.
- **The roster stays small in the router's prompt** past ten or so agents: a first pass by embedding the message
  against each agent's role (memory's embedding engine), then the router over the top few.
- **A member reads only what concerns it**: the lines since its last turn there, capped, as `roomInput` reads a room's
  window today; past the cap a rolling summary of the room (the `summary-router` numbers) instead of more lines.
- **Limits** as rooms have them: answers per hour, a pause per agent.

## Re-running

```bash
pnpm bench:group-chat --dry --work-steps 4 --rounds 6       # no model, free: prompt sizes and an ideal cache
pnpm bench:group-chat --only split-router,shared-router     # OpenRouter (secret "openrouter"), gpt-4.1-nano
pnpm bench:group-chat --provider gemini                     # Gemini (secret "gemini")
```

The key is read through APX's secret store (`APX_HOME`, by default the owner's) or `BENCH_API_KEY`, never printed.
Raw calls, picks and answers go to a JSON file in the temp folder (`--out`).
