# History

The long *why* behind rules the code enforces: domain rules, provider or library
quirks, fixes and workarounds. Not an ADR (choices between alternatives go to
[`decisions/`](decisions/)), not a changelog, not a system map.

Add an entry only when the code alone does not show the reason and someone
could undo it by "simplifying". Group entries by area; each has a stable anchor
and three fields:

```markdown
## Area

<a id="short-slug"></a>
### One-line rule title
**Rule:** what must stay true.
**Why:** what broke, or would break, without it.
**Where:** the files and tests that enforce it.
```

Every place listed in **Where** carries a one-line comment ending in
`See rules/HISTORY.md#<anchor>`. No personal data, machine-local paths or
real quotes (rule 3).
