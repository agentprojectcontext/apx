# Releasing APX v2

How v2 leaves the private working repo and reaches people. The product plan for updates is
[`plan/00-plan-maestro.md`](../plan/00-plan-maestro.md) §12; what was built is [D-044](DECISIONS.md#d-044).

## History

The private working repo's older commits carry a work email, AI-tool trailers and a few real names, so its history
is never pushed as is. Before publishing, a copy of `main` is rewritten outside the repo with `git filter-repo`:

- every author and committer becomes the owner's GitHub noreply address, dates in UTC;
- `Co-Authored-By` (AI tools), `Claude-Session` and "Generated with" trailers are dropped;
- the few real names left in old file versions and messages become placeholders.

The final tree must equal `main`'s (`git rev-parse HEAD^{tree}` on both) and `pnpm check:commits HEAD` must pass on
the copy. The rewrite script and its replacement list live beside the checkout, never in it (they would publish
what they remove).

From then on new commits must be public-safe as they are made: `pnpm check:commits` scans the commits on no remote
yet (or a range: `pnpm check:commits HEAD`), and `verify` runs it over the whole history in the public repo.

## Where v2 lives

v2 is published into v1's public repo (`agentprojectcontext/apx`), which every v2 install already watches:

1. `release/v2`: v2's rewritten history as its own branch, unrelated to v1's `main`. v1's semantic-release only
   releases from `main`, so the branch never publishes to npm.
2. Releases are `v2.x.y` tags on that branch. While v1 and v2 share the repo they are created **not latest**
   (`APX_V2_LATEST` unset): v1 keeps GitHub's "Latest" for its npm users, and v2 installs still find them because
   they pick the newest `v2.x.y` from the release list themselves.
3. Unification, at the end: on `release/v2`, `git merge -s ours main --allow-unrelated-histories`, then `main`
   fast-forwards to it and v1's old `main` stays as branch `v1`. Both histories survive and `main` holds v2. Set
   `APX_V2_LATEST=true` from then on.
