# 01 — Plan a change

> Before the first edit. Output is a short written plan, not a refactor.

The point is to replace *guessing where the code is* with *knowing*. In a repo
where the same operation can exist in a route, a CLI command and a tool handler,
the expensive mistake is fixing the copy nobody calls.

## Trace the real execution path first

Name the actual entry point and follow it down. Not "the agent loop" —
`api/exec.js` → `core/agent/run-agent.js` → which handler.

```bash
grep -rn "<the thing>" src/core src/host src/interfaces --include=*.js | grep -v node_modules
```

Three checks that catch most misdirected work:

- **Is there more than one copy?** Rule 8. If a route and a CLI command both do
  it, the fix belongs in `core/` and both call it. Do not fix one copy.
- **Does a shared kernel already cover it?** Paths, JSON I/O, frontmatter,
  project resolution, scope normalization, spawn-capture, constants all have
  exactly one home ([`architecture.md`](../architecture.md)). Copy #2 is a bug.
- **Which layer is this?** `core` / `host` / `interfaces` — say it out loud. If
  the answer is "core, but it needs the Express request", the design is wrong.

## Then write down, briefly

1. **What changes** — the concrete files and functions.
2. **The contract** — is a route shape, a tool name, a config key or an adapter
   contract changing? Those have downstream readers (skills, docs, other
   adapters) and rule 6 applies.
3. **State and side effects** — does it write under `~/.apx`, send a message,
   spawn a process, touch a permission mode? Those need a direct test (rule 1).
4. **Structural?** New module, new family, moved logic, new dependency →
   [`06-architecture-drift.md`](06-architecture-drift.md) applies at the end.
5. **How it will be verified** — the exact command, chosen now. If you cannot
   name one, that is the finding: the change is not yet verifiable.
6. **What could break silently.** Most failures here are silent (a routine that
   stops firing, an adapter that swallows an option, a missing `en.ts` key that
   serves Spanish). Name the silent failure mode before you write the code.

## Do not

- Do not bundle an unrelated refactor. A narrow diff is what makes stage 3
  possible.
- Do not add a dependency without stating why the platform and the existing
  primitives are insufficient.
- Do not plan a speculative abstraction. Build the registry on day one only when
  the family is real (rule: OCP, [`architecture.md`](../architecture.md)).
