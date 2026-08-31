# 06 — Architecture drift check

> Run it when the change is structural: a new module, a new family, logic that
> moved between layers, a new dependency, a new surface.
>
> **Compare against what this repo already does — not against an architecture
> you know from elsewhere.** Imposing Clean Architecture, DDD, a service layer or
> a React-shaped pattern onto a coherent codebase is drift, not improvement.

## Check against the three references

1. **[`AGENTS.md`](../../AGENTS.md)** — the numbered rules, especially 7, 8, 9, 10,
   12, 13, 16.
2. **[`architecture.md`](../architecture.md)** — the methodology and the
   reference implementations to copy from.
3. **The neighbouring code.** If every sibling in a directory is an 8-line
   adapter delegating to a shared factory, a 200-line hand-rolled one is drift
   even if it works.

## The questions

**Direction.** Does anything import upward? ESLint catches the import; you have
to catch the *logic*. A framework object accepted as a parameter into `core/` is
an upward dependency wearing a disguise.

**One home.** Did this create a second copy of an operation that already exists?
Did it add a helper that duplicates the shared kernel?

**The extension mechanism.** If this adds a member to a family, does it go
through the registry, or does a consumer now import the concrete adapter
directly? That bypass is how `confirmation/adapters/` went half-dead without
anyone noticing.

**Interface stability.** Did a contract change — an adapter's shape, a route's
response, a tool's name, a config key? Who else implements or reads it? Every
sibling adapter has to be checked, not assumed.

**New family?** If this is the first member of something that will have more,
build the registry now. If it is the *only* member and always will be, do not.

**New dependency?** State why the platform and the existing primitives are
insufficient. If it is optional, does the code degrade when it is absent?

**Enforced or hoped-for?** If the change relies on a rule holding, check
[`enforcement.md`](../enforcement.md): is that rule a gate or a paragraph? The
survey's finding was blunt — **the rules being violated are the ones that exist
only as prose.** If your change depends on a prose rule, consider adding a gate
in the same change. Prefer, in order: a lint rule, a test in `tests/`, a ratchet
script.

**Islands.** `src/interfaces/tui/` is a vendored fork with zero `#core/`
imports, by design. "One domain function, one home" does not apply inside it.
Do not wire it to core.

## Output

Either "no drift" with the checks you actually ran, or the specific rule and the
specific line. If you believe the *rule* is wrong, say so — argue it down in the
config with a comment explaining why. Never weaken a rule to get green.
