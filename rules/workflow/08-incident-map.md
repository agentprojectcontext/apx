# 08 — Incident map

> Something is broken and you do not yet know why. Read this **before** changing
> code. The goal of this stage is evidence, not a fix.
>
> The failure mode it prevents: a large refactor that hides the diagnosis, ships,
> and leaves the original bug in place.

## Step 0 — is the code even running?

Ask this first, every time. It is the answer more often than any other single
cause in this repo.

```bash
ps -o command= -p "$(pgrep -f 'src/host/daemon/index.js' | head -1)"   # which checkout?
apx restart
curl -s 127.0.0.1:7430/api/health                                      # uptime_s near zero
```

If the daemon is running from a different checkout, or was never restarted after
the change, **stop** — there is no bug to investigate yet.

## Step 1 — bound the symptom

Which surface? One, or all of them at once?

- **One surface** (only the panel, only Telegram, only the phone) → the adapter
  or that surface's own code. The daemon is probably fine.
- **All surfaces** → the daemon, `core/`, or state under `~/.apx`.
- **Only in one project** → project resolution or `.apc/` config.
- **Only sometimes** → a race, a retry, a fallback chain, or an optional
  dependency that is sometimes absent.

## Step 2 — collect evidence, in this order

```bash
apx daemon logs --tail 100          # first, always: silent failures show up here
curl -s 127.0.0.1:7430/api/health
```

Then, matching the symptom: the browser console and network tab for the panel;
`apx exec "…"` for the agent or tool loop; the route directly (`curl`) for an
API question; `node scripts/inspect-channel-prompts.js` for prompt behaviour.

Reproduce it **once, deliberately, and write down the exact input**. A bug you
cannot trigger on demand is a bug you cannot prove you fixed.

## Step 3 — rank hypotheses before testing them

Write two or three, most likely first, each with the single observation that
would kill it. Then test the cheapest one. Guessing and patching in the dark is
how a real cause gets buried under three speculative fixes.

Priors worth carrying into this repo, roughly in order:

1. The daemon is running old code (step 0).
2. Something failed **silently** — an MCP that did not spawn, an embedding
   backend that is down, a routine that stopped firing, a `catch` that swallowed.
3. There are **two copies** of the operation and you are reading the one that is
   not called.
4. An adapter accepted an option and ignored it.
5. State under `~/.apx` is stale or from an older format.
6. A missing key or config falling back silently — a missing `en.ts` key serves
   the Spanish string with every gate green.
7. An optional dependency (`better-sqlite3`, `sqlite-vec`, `puppeteer`) is
   absent.

## Step 4 — mitigate safely, then fix properly

If something is actively broken for a human, the safest reversible mitigation
first (revert, disable the routine, fall back). Say clearly that it is a
mitigation.

**The permanent fix comes after the evidence, never before it** — and it lands
with a regression test that fails without it (rule 1). If you cannot write a test
that would have caught the bug, you have not finished understanding it.

## Output

Symptom → boundary → evidence collected → hypotheses ranked → what the evidence
actually showed → mitigation applied (if any) → proposed fix. Keep the
hypotheses you ruled out; the next person needs to know what was already checked.
