# 07 — Owner brief

> The last thing you write and the only thing that is certain to be read.
>
> Written for someone who **decides**, not for someone who will read the diff.
> Assume they do not know the library you used and should not have to.

## The shape — eight short items, in this order

**1. What changed, in behavior.** What is different for a person using APX. Not
"refactored the resolver" — *"a project agent can no longer read another
project's files."* If nothing is observably different, say "no visible change"
and explain why the work was needed.

**2. How it flows.** The path, named: entry point → where the work happens →
what it writes. Three or four hops, not a diagram.

**3. Files worth knowing.** The two or three a future reader will actually need.
Not the full diff — that is what the diff is for.

**4. Evidence.** The commands you ran and what they returned. `preflight`
result, the runtime check, the specific path you exercised.

**5. What is UNVERIFIED.** Explicitly. Anything you could not run, and why. This
item is never empty just because it is uncomfortable — see
[`05-test-and-runtime.md`](05-test-and-runtime.md).

**6. Risk and blast radius.** What breaks if this is wrong, and who notices —
one surface, or every channel at once? Does it touch a boundary that got a
security review?

**7. Assumptions.** What you decided without asking. Every one of these is a
place the owner may disagree, and they can only do that if you list them.

**8. Rollback.** How to undo it. `git revert` plus `apx restart`, or something
more? If the change wrote state under `~/.apx` or changed a file format, undoing
the code is not enough — say so.

Add a ninth item, **architecture impact**, only when the change was structural.

## Tone

Plain sentences. No "successfully implemented", no "comprehensive", no summary
of how hard it was. If tests fail, the brief says so and shows the output. If a
step was skipped, the brief says which. A brief that reads as advocacy is a
brief the owner has to double-check, which defeats its purpose.

**One accurate paragraph beats a page of structure.** For a small change, items
1, 4, 5 and 8 alone are a complete brief.
