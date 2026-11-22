---
title: Contextual research
description: Research your projects and interests and include one useful finding in an existing report.
---

Contextual research is separate from activity review. Activity review proposes improvements from recent conversations; contextual research reads public sources and looks for an actionable connection with your projects or interests. Neither feature executes its suggestions.

## Configure before enabling

Ask your super-agent to help configure research. It can propose changes through `apx_settings` using `discovery.configure`; changing the configuration always has an approval card. Installation does not enable research or change existing routines.

Choose:

- All registered, readable projects, or an explicit selection.
- Public official pages for each project. Include relevant sections such as pricing, release notes or documentation. Public search terms are optional. APX does not send private conversation excerpts or generated hypotheses to search engines.
- Optional interests, expressed as terms you authorize APX to search publicly. An optional city or region can narrow those searches. APX does not determine or track your location.
- A deep-research interval, initially two days; limits on model calls, web operations and elapsed time; and a repeat-topic cooldown.
- An existing global report run by your super-agent and your time zone. The report's own schedule controls delivery: selecting it does not move it to 9:00. Ask to change that routine if you want a different time or different weekdays.

You can allow authorized conversations and decisions, public websites mentioned in project context, and interest news independently. The website option starts from HTTPS origins already referenced in the selected projects; it does not publish their private questions as searches. You can add specific official sections separately. A referenced website is not automatically treated as an official authority.

Every daily pass scans all eligible project contexts. Bounded private model requests then discover concrete questions, rotating through projects rather than only looking at recent tasks. Public research has its own progressive coverage; the settings distinguish scanned projects, questions explored and sources checked. A large project list may take several passes within your limits.

Research uses the auxiliary model. There are no new dependencies, privileged browser sessions, device actions or automatic project changes. Public pages use the same network protections as web reading. A search operation can try up to three search engines; its returned snippets are never evidence.

## What reaches your report

APX keeps a bounded set of findings with source URLs, exact supporting excerpts, read times, uncertainty and a suggested next step. It includes at most one finding in the selected report on each local calendar date, without creating a second report.

On days between deep research runs, a still-relevant, previously unused finding may be included. If there is no supported finding, the report contains no research item: APX does not fill the space with a weak topic or repeat yesterday's item. Your ordinary report still runs.

Unavailable or unreadable sources are recorded, not treated as evidence. A source that needs JavaScript or a sign-in may remain unreadable to this background check. Research is bounded and is not an exhaustive audit of the web or your codebase. Exact quotations establish where evidence came from. A separate model request checks material support, relevance and novelty before a finding is accepted; interpretation can still be wrong. Both proposal and verification calls count toward the model-call limit.

Mark a finding useful or not useful to influence future selection, or mute its topic. Feedback and cooldown records persist. The Muted topics section lets you undo a mute even after a settings change has discarded its cached finding. Changing source authorization discards cached findings; switching research off stops future work without deleting or rescheduling the selected report.

## Reliability and privacy

A project must remain registered, readable and in the selected scope to contribute a finding. Project references are prepared separately; research does not send one project's conversations into another project's model request. Only explicitly configured public search terms, interests and optional location are used for searches.

Background work has a deadline and persists its outcome. An interrupted request is not silently replayed after restart. Inclusion in a report is reserved with that report's admission transaction, so a failed admission does not consume the finding. The core appends the selected finding to the completed report, or to its first message to the owner if that routine sends its report itself. It does not rely on the model repeating a prompt suffix. A quiet base report can carry the finding alone. Failure or cancellation does not cause a new research message; a report the routine sends itself keeps its existing immediate delivery semantics. Once admitted, a failed or suppressed report does not automatically repeat the finding in another report. Reservation and composition are recorded separately; neither proves that an external channel delivered the report.
