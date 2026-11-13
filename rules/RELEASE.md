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
yet (or a range: `pnpm check:commits HEAD^..HEAD` for only the last commit), and `verify` runs it over the commits each push or pull request brings
to the public repo ([D-087](DECISIONS.md#d-087)).

## Where v2 lives

v2 is `main` of the public repo (`agentprojectcontext/apx`) since 2.11.0, and its releases are GitHub's "Latest"
(`APX_V2_LATEST=true`). How it got there: v2 grew on its own branch, `release/v2`, beside v1's `main`; at the
launch `release/v2` took v1's `main` in with `git merge -s ours --allow-unrelated-histories`, `main` fast-forwarded
to it and `release/v2` was deleted. v1's last `main` stays as branch `v1`, with v1's docs (built into `/v1/` by
`pages.yml`) and its own semantic-release, which publishes v1 to npm from that branch. `verify` leaves the commits
`origin/v1` holds out of its commit check.

Day-to-day work goes to `staging` (verify runs on every push there); `main` is the last release. Cutting a version
fast-forwards `main` to a `staging` commit whose verify passed, waits for verify on `main`, then tags it (below).
An owner-authorized urgent hotfix may go from its task branch directly to `main`, without passing through
`staging` first. Preserve changes already on `main`, verify the candidate locally before pushing, and wait for
`verify` on that exact `main` commit before tagging. Bring the released fix back into `staging` afterward; the
exception does not bypass checks or permit moving a published tag.

`pages.yml` publishes the site from `main`, so the docs change with a release, not with each push. The site lives at
`https://apxagent.app/`, the repository's Pages custom domain (DNS in Cloudflare, DNS only, pointing at GitHub Pages);
GitHub sends every `agentprojectcontext.github.io/apx/…` address on to the same path there.

## What a release carries

The release starts as a draft. After all desktop, daemon and Android jobs upload successfully, the publication
job waits for the `verify.yml` run on `main` for that exact tag commit to pass, then exposes it to update
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

## Documentation coverage before release

Before GO, compare the actual previous-tag-to-candidate diff, including fixes, with the
[documentation impact assessments](WORKFLOW.md#documentation-impact-contract). Check guides, reference,
troubleshooting and engineering rules; update/create affected pages in English and Spanish, validate built links
and distinguish candidate-only features from the currently tagged version. Record specific no-change reasons
and unresolved gaps. Do not infer coverage from release news, green builds or commit titles alone.

## Mandatory minor upgrade proof

Before publishing a new minor, exercise the previous **published** version and the candidate artifacts in an
isolated core/home (a separate core, VM or container), never the developer's live installation. Seed representative
demo data, update through the installed updater, verify startup/health and check that the data survives. Also update
the previous desktop client while connected to an external core, then verify reconnection and a basic operation.
Unit migration fixtures, a fresh install and a build smoke test do not replace either journey.

Keep previous/candidate versions and commit/artifact hashes, commands, outcomes and logs/screenshots. Unsupported
or unexercised platform paths remain unverified. Missing or failed evidence blocks a minor; this policy alone does
not impose the matrix on patches and never authorizes a tag. Compare against the previous published release, not
only the patch digit: after a failed `x.y.0`, publishing `x.y.1` still introduces a minor.

`release:check --tag` and the publication job require a successful `minor-upgrade.yml` run on the exact candidate
commit on `main`, named for both the target and the previous published release. Missing, stale, failed or ongoing
evidence fails closed; a green ordinary `verify` is insufficient. Dispatch it after that commit reaches `main`,
without creating a tag:

```bash
gh workflow run minor-upgrade.yml --ref main -f previous=2.14.0 -f target=2.15.0
```

The workflow builds the exact candidate, downloads and checksum-checks the previous official daemon and desktop
ZIP, and runs `scripts/minor-upgrade.ts`. Separate temporary homes hold the installed core and remote desktop
client. The daemon uses the previous installed updater and preserves a demo chat, task, memory, agent and home
identity. Its fixture supervisor restarts only its own child on the normal restart exit code; the native app uses
its real download, swap and restart bridge. An `open` wrapper forwards to the real macOS launcher with an isolated profile and the same mock keychain as
the initial test launch, so relaunch cannot attach to the developer's desktop session or prompt for its login keychain.
This fixture flag is not a production keychain configuration. Receipts include commit/artifact hashes, health/data checks, process logs and
native before/after screenshots; even a failed run keeps its available evidence as an Actions artifact.

This matrix currently runs on macOS arm64. It is not Linux, Windows, SSH-transport or mobile upgrade proof; report
those separately if required for a change. A native launch or debugger failure fails the matrix, never skips the
client journey. `release:check --check-tag <tag> <ref>` performs the same checks without creating or pushing a tag.

## Tagging a release

`main` first takes `staging`, fast-forward only, so it holds exactly what was verified there:

```bash
git fetch origin && git push origin origin/staging:main   # refused unless it is a fast-forward
```

Only a commit `verify` already passed on `main` is tagged (AGENTS.md rule 28). A tag builds every installer
and the APK in about ten minutes, but publication waits for that commit's verify run: tagging before it ends ties
the release to a run that may still fail, and a red run leaves a draft that only a new tag (and a new version) fixes.

```bash
git fetch origin main
pnpm release:check origin/main                     # is its newest verify run green? exits 1 if red, missing or running
pnpm release:check origin/main --wait              # …waiting for a run still going
pnpm release:check --tag v2.10.0 origin/main       # checks, then tags that commit and pushes the tag
```

`scripts/release-check.ts` reads the newest `verify.yml` run of that exact commit on `main` (`gh run list
--commit`), the run the publish job will wait for; a rerun that turned it green counts. The publish job's wait stays
as the second guard, for a tag made by hand.

### A failed release

A release whose build failed stays a draft, and its tag is spent: fix the cause on `staging`, then tag the next
patch version (a published tag is never moved). The Discord announcement and the issue replies read the commits since
the previous *published* release (`scripts/release-previous.ts`), so the version that ships tells what the failed one
carried too. Delete the failed draft and its tag once the next version is out, so nothing else reads it as released.

## What people are told

The same commits since the previous published release, each subject as a sentence, reach people three ways: the Discord
announcement, the replies to the issues a release fixes, and, inside APX, the super-agent's "what's new" chat on the
first start of the new version ([D-100](DECISIONS.md#d-100)). So a commit subject is release text: write it for the
people who use APX. Only `feat`, `fix` and `perf` commits are shown.

Release news are the other half: what a release lets an owner's super-agent do for them, told once, in its own words,
with a button or two to start ([D-117](DECISIONS.md#d-117)). They are written by hand in
`apps/core/src/news/entries.ts`, one entry per thing worth acting on, by whoever ships that thing (AGENTS.md rule 25):
`since` is the first release that has it, `applies` reads the install's facts (`newsFacts`: widgets, Google parts,
the running profile…) so only owners it helps hear it. `title` and `about` are what the owner reads in Help › What's
new, in English and Spanish and in their words; `text` is what the super-agent is told ([D-182](DECISIONS.md#d-182-news)). An owner who updates past several releases hears every entry
they have not heard that applies; a fresh install hears none. Before tagging, check that each owner-facing `feat`
since the last tag either has an entry or is not worth offering.

`since` is a real release, never a guess. `pnpm check:since` (in preflight) reads every news entry and welcome slide:
one the newest release tag already has keeps its `since`; one no release has yet must name the next release of its
line, which is the next minor for `staging`'s work and the next patch (or minor) for `main`'s. A release already cut
without it is refused. Staging ships in the next minor, so a feature merged into `staging` after `v2.14.3` says
`2.15.0`, not `2.14.4`. `release:check --tag v2.x.y` runs `check:since --release v2.x.y` on its HEAD and tags only
when everything new since the last tag says that version.

## Issues a release fixes

A commit that fixes a GitHub issue ends its message with a trailer, one per issue: `Issue: #105`. Once that commit
is pushed to origin's `staging` (not before: a local commit or an unmerged branch has fixed nothing yet), whoever
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
`https://apxagent.app/install.sh` and `…/install.ps1` (the older `/v2/install.sh` and `…/install.ps1`
stay served, and the github.io addresses redirect there: installed apps and older docs give them). The script finds the newest v2 release itself.

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

The macOS Desktop build requires a macOS host with Xcode command-line tools. `scripts/package.ts` passes its exact
`APX_TARGET` to the desktop build; the private Swift observer is compiled and checked for that architecture before
packaging, then copied outside ASAR to `Resources/computer/observer`. It is not part of the standalone daemon bundle.
Non-macOS targets do not compile or ship it. Cross-packaging macOS on another OS is refused, not silently skipped.
Any native build error aborts packaging, even when filesystem permissions prevent removal of an old binary. Do not
invoke electron-builder on stale build output after such an error. Ad hoc signing verifies consistency only; it does
not authenticate a publisher. Final nested package signing and accessibility permission behavior require separate
runtime verification before the observer can be enabled.

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
