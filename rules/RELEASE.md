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

`release.yml` on a `v2.x.y` tag: for linux x64/arm64, win x64, mac arm64/x64 the desktop installer (AppImage, NSIS
`.exe`, `.dmg`, plus a `.zip`), the daemon bundle `apx-core-<v>-<os>-<arch>.tar.gz`, a `.sha256` beside each,
`install.sh` / `install.ps1`; and the Android APK. Nothing is signed yet but the APK (with the repo's
`ANDROID_KEYSTORE_*` secrets, the same as v1's): macOS needs an Apple Developer ID and notarization, Windows an
Authenticode certificate (Azure Trusted Signing is the cheap one). Until then the install docs must say how to open
an unsigned app (macOS: right-click › Open, or System Settings › Privacy & Security; Windows: SmartScreen › More info).

The phone app is `dev.apx.mobile` and v1's is `dev.agentprojectcontext.apx`: they install side by side. Its APK
carries arm64-v8a only and its versionCode follows the tag (2.1.3 → 20103); Expo push needs the owner's EAS project
and Firebase app, set once as repo variable/secret ([apps/mobile/README.md](../apps/mobile/README.md#push)).

## Install paths

| Who | How | Notes |
|---|---|---|
| New, with a desktop | the installer, then the first run (server or client) | |
| New, a server or VM | `install.sh \| bash` (or `install.ps1`), then `apx setup --headless` | over SSH, linger needs root: install.sh uses passwordless sudo when it can, else says the command |
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
