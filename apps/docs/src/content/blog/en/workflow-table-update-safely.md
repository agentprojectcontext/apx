---
title: "How to avoid duplicate records in an AI workflow"
description: "Choose a stable record key and test updates before connecting live data."
lang: en
slug: workflow-table-update-safely
draft: false
published: "2026-11-08"
image:
  src: ../../../assets/blog/workflow-table-update-safely/hero.webp
  alt: "A table linked to a branching workflow."
  caption: "Conceptual illustration, not a screenshot."
sources:
  - label: "APX documentation"
    url: "https://apxagent.app/docs/office/routines/"
    checked: "2026-11-08"
---

A form can send the same event twice. If a workflow creates a new record on every arrival, a follow-up may be duplicated even though the person submitted only once. Decide what identifies the record before turning on automation.

## Choose a key that matches the job

For a test, use a fictional identifier that stays the same when the same event is repeated. Decide whether two events with that identifier should update one record or represent separate transactions. Avoid using a person’s email as a universal key if one person can legitimately have multiple orders.

The [APX flows guide](https://apxagent.app/docs/office/routines/) describes a Save to table step: saving under the same key changes only the columns that step fills. Read table can retrieve one row by key or the latest rows. This is a building block, not a guarantee that every outside action is deduplicated.

## Test both repetition and change

Send a harmless sample event, inspect the row, then send it again and confirm the intended fields. Try a second key and a missing value. Check the run log and the actual table, not just the success indicator.

If the flow also sends email or calls an external API, inspect that destination separately. A repeated event can still repeat an external side effect. Define retry and recovery rules before enabling live inputs.
