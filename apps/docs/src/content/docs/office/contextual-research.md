---
title: Contextual research
description: Research your projects, interests and places, and hear about what is worth knowing.
---

Contextual research is separate from activity review. Activity review proposes improvements from recent conversations; contextual research reads public sources and looks for an actionable connection with your projects or interests. Neither feature executes its suggestions.

## Turn it on

Research starts off. Installing or updating APX does not turn it on or change your routines; it only fills in what research would start with, so turning it on asks you nothing:

- all your registered, readable projects;
- the time zone in your profile;
- telling you on its own (**Automatic**, below);
- the default limits.

When you turn it on, your super-agent offers once to fill in your interests, pages and places from what it already knows about you. It asks at most one question if something important is missing.

## It fills in as you chat

While research is on, your super-agent adds what comes up in conversation: an interest, a project to follow, an official public page, a city or region you care about. Interests are kept as short search terms of one to four words: "AI coding agents, especially news about Claude Code and Codex" becomes three interests, "AI coding agents", "Claude Code" and "Codex". It does it without stopping the chat or asking for approval. The answer shows a small **Research updated** line; open it to see what was added. Only what you say yourself counts: a routine, a contact or another agent cannot add to it, and a page found on the web is added only when you give it in a message of your own. Adding never discards what research already found.

Turning research on or off, its scope and its limits still go through an approval card when your super-agent changes them (`discovery.configure`). While research is off, your super-agent is not told about it and adds nothing.

## How you hear about findings

In **Settings › Research › How you hear about it**:

- **Automatic** (the default): if a finding can't wait, such as a wrong price on your own product's site or a breaking change in something you use, APX tells you right away. Everything else (news, events near your places, things about your interests) comes together in one short summary at 8 in the morning in your time zone, at most three findings a day. Both arrive as your super-agent's message in Home and reach you where its notices do, respecting your quiet hours. APX is conservative about "right away": when in doubt, a finding waits for the summary.
- **In a routine**: one finding is added to a routine your super-agent already runs for you (a morning brief, for example), at the time that routine has. **Create a routine** opens the routine editor if you have none yet. Choosing the routine does not move it; ask to change the routine if you want another time.

There is no option to keep findings to yourself: to stop hearing about them, turn research off.

## Review and edit

In **Settings › Research**, the switch at the top turns research on or off at once. While it is off, APX looks nothing up; turning it on shows the setup. Changes to the setup are kept until you choose **Save changes**, which restarts research with the new choices; **Discard** puts back what was saved.

You can review and change:

- **All my projects**, or the ones you tick in the projects menu; the chosen ones show under it.
- Public official pages for each project. Include relevant sections such as pricing, release notes or documentation. Public search terms are optional. APX does not send private conversation excerpts or generated hypotheses to search engines.
- Optional interests: short topics, one to four words each, that APX may search publicly. Type a topic and press Enter, a comma or **Add**.
- Places: cities or regions, to hear about news and events near there. Each is searched on its own. APX does not determine or track your location.
- Limits on model calls, web operations and elapsed time, and a repeat-topic cooldown.

Your projects are looked at every day; public pages are read in depth every other day, which keeps the pages read and the helper model's work low while news is still fresh. This is not a setting.

Research uses the time zone in your profile (**Settings › Account**) to decide what counts as a day. If your profile has none, it uses the research's own time zone, UTC unless your super-agent changed it.

You can allow authorized conversations and decisions, public websites mentioned in project context, and interest news independently. The website option starts from HTTPS origins already referenced in the selected projects; it does not publish their private questions as searches. You can add specific official sections separately. A referenced website is not automatically treated as an official authority.

Every daily pass scans all eligible project contexts. Bounded private model requests then discover concrete questions, rotating through projects rather than only looking at recent tasks. Each question is chosen so the official pages you listed for that project could answer it. Public research has its own progressive coverage; the settings distinguish scanned projects, questions explored and sources checked. A large project list may take several passes within your limits.

Research uses the helper model (**Settings › Helper model**). There are no new dependencies, privileged browser sessions, device actions or automatic project changes. Public pages use the same network protections as web reading. Every redirect is checked before connecting: project pages stay on their approved origins and cannot redirect into URLs carrying query parameters. A search operation can try up to three search engines; its returned snippets are never evidence.

## What a finding holds

APX keeps a bounded set of findings with source URLs, exact supporting excerpts, read times, uncertainty and a suggested next step. Each finding is told once. In a routine, at most one finding joins it on each local calendar date, without creating a second report; on days between deep research runs, a still-relevant, unused finding may be included.

If there is no supported finding, nothing is told: APX does not fill the space with a weak topic or repeat yesterday's item. A routine you chose still runs as usual.

Unavailable or unreadable sources are recorded, not treated as evidence. A source that needs JavaScript or a sign-in may remain unreadable to this background check. Research is bounded and is not an exhaustive audit of the web or your codebase. Exact quotations establish where evidence came from. A separate model request checks material support, relevance and novelty before a finding is accepted; interpretation can still be wrong. Both proposal and verification calls count toward the model-call limit. The minimum is three calls; deep research reserves two for a proposal and its verification even when project questions keep changing. Search-engine unavailability is recorded separately from a successful search with no results.

Mark a finding useful or not useful to influence future selection, or mute its topic. You can rate a finding in Research or reply to the message that told you; confirm the change if APX asks. Feedback and cooldown records persist. The Muted topics section lets you undo a mute even after a settings change has discarded its cached finding. Changing source authorization discards cached findings; switching research off stops future work without deleting or rescheduling a routine you chose.

## Reliability and privacy

A project must remain registered, readable and in the selected scope to contribute a finding. Project references are prepared separately; research does not send one project's conversations into another project's model request. Only explicitly configured public search terms, interests and optional location are used for searches.

Background work has a deadline and persists its outcome. An interrupted request is not silently replayed after restart. Each automatic message marks its findings as told when it is posted, so a restart never repeats them. In a routine, inclusion in a report is reserved with that report's admission transaction, so a failed admission does not consume the finding. The core appends the selected finding to the completed report, or to its first message to the owner if that routine sends its report itself. It does not rely on the model repeating a prompt suffix. A quiet base report can carry the finding alone. Failure or cancellation does not cause a new research message; a report the routine sends itself keeps its existing immediate delivery semantics. Once admitted, a failed or suppressed report does not automatically repeat the finding in another report. Reservation and composition are recorded separately; neither proves that an external channel delivered the report.
