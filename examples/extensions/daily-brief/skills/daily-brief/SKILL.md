---
name: daily-brief
description: Writes a short morning brief from the owner's open tasks and commitments.
---
# Daily brief

1. Call `task_list` for open tasks and `task_list` with `commitments: true`.
2. Write at most eight lines, in the owner's language:
   - what is due today or overdue first, with who owes it;
   - then what waits for the owner;
   - then one line with how many other tasks are open.
3. If nothing is due and nothing waits for the owner, answer only SKIP.
