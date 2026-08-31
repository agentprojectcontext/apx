# 03 — Independent review

> **Fresh context.** A reader who has not seen the reasoning that produced the
> change. An agent re-reading its own diff confirms its own assumptions — that is
> exactly the failure this stage exists to break.

Read the requirement and the diff. Do not read the implementation notes first;
they will tell you what the code was *meant* to do, which is the thing under
test.

## Ask, in this order

**1. Does it do what was asked — and only that?**
Requirement vs diff, line by line. Scope crept? Say so. A change that also
"fixed" three unrelated things is not reviewable, whatever its quality.

**2. Is it in the right layer?**
`core` / `host` / `interfaces`. ESLint catches an upward *import*; it cannot see
misplaced *logic*. Two dodges that pass lint and are still violations:
a framework object passed into core as a parameter, and `os.homedir()` wrapped
in a local helper before rebuilding an `~/.apx` path.

**3. Is this a second copy?**
The most common real defect here. Does the operation already exist in `core/`,
in a sibling adapter, in the shared kernel? Grep before accepting a new helper.

**4. Async and state.**
Is a route handler wrapped in `asyncRoute()`? Does it do sync I/O on a request
path (rule 15 — `fs/promises`; sync is for boot only)? Can two turns race the
same file? Is there stale state held across a restart that should not be?

**5. What fails silently?**
Walk every `catch`, every default, every fallback. Does a failure surface
anywhere a human will see it, or does the feature just quietly stop? This is the
house failure mode; look for it specifically.

**6. Does an adapter swallow part of its contract?**
If the change touches a family (engines, runtimes, handlers, embed engines),
check it honors every option the family passes — or declares that it cannot.

**7. Are the runtime assumptions real?**
Does it assume the daemon restarted? That a file exists? That a config key is
set? That an optional dependency (`better-sqlite3`, `sqlite-vec`, `puppeteer`)
is installed? Optional means *sometimes absent*.

**8. Do the tests test behavior, or mirror the implementation?**
A test that re-asserts the code's own structure passes forever and catches
nothing. For a bug fix: **would this test have failed before the fix?** If it
would not, it is not a regression test.

**9. Is anything it documents now false?**
Skills, `docs/`, the comment above the function, a table in `rules/`.

## Output

Findings ranked most severe first. For each: **file:line**, one sentence on the
defect, and a **concrete failure scenario** — inputs or state → wrong result.
"This looks fragile" is not a finding. If nothing survives that bar, say the
review found nothing; an empty result is a real result.
