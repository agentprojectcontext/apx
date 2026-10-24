# Releasing APX v2

How v2 leaves the private working repo and reaches people. What was built for updates is
[D-044](DECISIONS.md#d-044).

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
yet (or a range: `pnpm check:commits HEAD`), and `verify` runs it over the commits each push or pull request brings
to the public repo ([D-087](DECISIONS.md#d-087)).

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

## What a release carries

The release starts as a draft. After all desktop, daemon and Android jobs upload successfully, the publication
job waits for the `verify.yml` run on `release/v2` for that exact tag commit to pass, then exposes it to update
clients and announcements. Failed builds or verification leave the draft available for repair. Tags build the
release artifacts; verification runs on the branch commit once, rather than duplicating the same suites for its tag.
Its jobs run in parallel parts ([TESTING.md](TESTING.md#ci)); publication still requires the whole workflow to
pass, and a failed job can be retried on its own.

`release.yml` on a `v2.x.y` tag: for linux x64/arm64, win x64, mac arm64/x64 the desktop installer (AppImage, NSIS
`.exe`, `.dmg`, plus a `.zip`), the daemon bundle `apx-core-<v>-<os>-<arch>.tar.gz`, a `.sha256` beside each,
`install.sh` / `install.ps1`; and the Android APK. Nothing is signed yet but the APK (with the repo's
`ANDROID_KEYSTORE_*` secrets, the same as v1's): macOS needs an Apple Developer ID and notarization, Windows an
Authenticode certificate (Azure Trusted Signing is the cheap one). Until then the install docs must say how to open
an unsigned app (macOS: right-click › Open, or System Settings › Privacy & Security; Windows: SmartScreen › More info).

The phone app is `dev.apx.mobile` and v1's is `dev.agentprojectcontext.apx`: they install side by side. Its APK
carries arm64-v8a only by default (`APX_ANDROID_ABIS` adds more) and its versionCode follows the tag (2.1.3 → 20103); Expo push needs the owner's EAS project
and Firebase app, set once as repo variable/secret ([apps/mobile/README.md](../apps/mobile/README.md#push)).

## Tagging a release

Only a commit `verify` already passed on `release/v2` is tagged (AGENTS.md rule 28). A tag builds every installer
and the APK in about ten minutes, but publication waits for that commit's verify run: tagging before it ends ties
the release to a run that may still fail, and a red run leaves a draft that only a new tag (and a new version) fixes.

```bash
git fetch origin release/v2
pnpm release:check origin/release/v2               # is its newest verify run green? exits 1 if red, missing or running
pnpm release:check origin/release/v2 --wait        # …waiting for a run still going
pnpm release:check --tag v2.10.0 origin/release/v2 # checks, then tags that commit and pushes the tag
```

`scripts/release-check.ts` reads the newest `verify.yml` run of that exact commit on `release/v2` (`gh run list
--commit`), the run the publish job will wait for; a rerun that turned it green counts. The publish job's wait stays
as the second guard, for a tag made by hand.

## What people are told

The same commits since the previous v2 tag, each subject as a sentence, reach people three ways: the Discord
announcement, the replies to the issues a release fixes, and, inside APX, the super-agent's "what's new" chat on the
first start of the new version ([D-100](DECISIONS.md#d-100)). So a commit subject is release text: write it for the
people who use APX. Only `feat`, `fix` and `perf` commits are shown.

Release news are the other half: what a release lets an owner's super-agent do for them, told once, in its own words,
with a button or two to start ([D-117](DECISIONS.md#d-117)). They are written by hand in
`apps/core/src/news/entries.ts`, one entry per thing worth acting on, by whoever ships that thing (AGENTS.md rule 25):
`since` is the first release that has it, `applies` reads the install's facts (`newsFacts`: widgets, Google parts,
the running profile…) so only owners it helps hear it. An owner who updates past several releases hears every entry
they have not heard that applies; a fresh install hears none. Before tagging, check that each owner-facing `feat`
since the last tag either has an entry or is not worth offering.

## Issues a release fixes

A commit that fixes a GitHub issue ends its message with a trailer, one per issue: `Issue: #105`. Once that commit
is pushed to origin's `release/v2` (not before: a local commit or an unmerged branch has fixed nothing yet), whoever
pushed it comments on the issue with what changed and the commit, and closes it as completed, without waiting for the
tag. Once the release is out and announced, `release.yml`'s `issues` job (`scripts/issue-replies.ts`) still comments
on each named issue with the version and the commits, closed ones included, and closes any left open; a version
already answered is skipped. To preview it locally: `TAG=v2.x.y node scripts/issue-replies.ts --dry`.

## Install paths

| Who | How | Notes |
|---|---|---|
| New, with a desktop | the installer or graphical install script, then first run (server or client) | no new daemon service before the choice |
| New, a server or VM | `install.sh \| bash -s -- --server` (or `install.ps1 -Server`), then `apx setup --headless` | over SSH, linger needs root: install.sh uses passwordless sudo when it can, else says the command |
| From the desktop, onto a server | first run › Client › SSH › "Install APX there" | sends the app's own install.sh over ssh and installs the app's version |
| v1 user | the desktop's setup imports from `~/.apx`; on a server install.sh stops v1 and `apx import-v1` imports from its files | a v1 installed with `sudo npm` needs sudo to go |
| Docker | `scripts/docker/Dockerfile` from a bundle | `APX_TOKEN` required; updates by image |

The install scripts have a URL of their own, served by the Pages site (`apps/docs` copies them in when it builds):
`https://agentprojectcontext.github.io/apx/v2/install.sh` and `…/install.ps1`. A release's `latest/download` URL would
be v1's while v1 is "Latest"; the script finds the newest v2 release itself either way.

## Testing

Everything here can be tried on the network before anything is published:

```bash
pnpm package:linux                                  # or :win / :mac; APX_VERSION=2.9.1 names the build
node scripts/install/feed.ts out/                   # a GitHub-shaped feed of those files on :7480
e2e/install/servers.sh build ~/.ssh/<key>.pub       # on any Docker host: clean Ubuntu servers with systemd + sshd
e2e/install/servers.sh feed out/                    # …and the feed beside them (http://apx-feed:7480)
e2e/install/servers.sh up fresh 2222                # ssh -p 2222 tester@<docker host>; `up old 2223 v1` has APX v1
e2e/install/servers.sh clean
```

On a server: `curl -fsSL http://apx-feed:7480/install.sh | bash -s -- --feed http://apx-feed:7480`; the install
keeps updating from that feed (`apx upgrade`). The desktop app installs onto one with `APX_RELEASES=<feed>` set.

## Verified before the beta

Tried for real on the network, from a local feed, with builds made the way `release.yml` makes them:

| Path | Linux (Ubuntu 24.04, systemd) | Windows 11 | macOS |
|---|---|---|---|
| `install.sh` / `install.ps1`, re-run, `--uninstall` | yes | yes | — |
| Over a running v1 (daemon stopped, npm package removed) | yes (sudo npm needs sudo) | yes | — |
| `apx import-v1` / the setup's import from v1's files | yes | yes | — |
| `apx setup --headless --expose lan`, panel from another browser (pairing screen) | yes | — | — |
| `apx open`, `apx desktop` (opens, or downloads and installs) | — | yes | UNVERIFIED |
| Desktop installer, first run as server or client | AppImage builds; UNVERIFIED | yes | builds, ad-hoc signed, launches |
| First run › Client › SSH › install on a server, linger, continue | yes (server side) | yes | — |
| Desktop app updates itself (2.2.3 → 2.2.4) | — | yes | UNVERIFIED |
| Daemon updates itself (`apx upgrade`) | yes | UNVERIFIED | — |
| Docker image | yes | — | — |
| Android APK (debug-signed), pair, chat | — | — | Samsung phone: yes |
