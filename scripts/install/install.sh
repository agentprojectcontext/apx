#!/usr/bin/env bash
# Installs (or updates) the APX daemon on Linux or macOS, without the desktop app: the core, the `apx` command and the
# Node that runs them, as one bundle from a release. Nothing needs root.
#
#   curl -fsSL https://github.com/agentprojectcontext/apx/releases/latest/download/install.sh | bash
#   bash install.sh --file apx-core-2.2.0-linux-x64.tar.gz      # a bundle you already have (no download)
#
# Options: --file <bundle>  --version <x.y.z>  --feed <owner/repo>  --no-service
# It lands in ~/.apx/v2/app (APX_APP to change it); your data stays in ~/.apx/v2, and APX v1's files in ~/.apx are never
# touched. If APX v1 is installed, its daemon is stopped and its `apx` command removed: this one takes its place.
set -euo pipefail

FEED="${APX_RELEASES:-agentprojectcontext/apx}"
APP="${APX_APP:-$HOME/.apx/v2/app}"
BIN="$HOME/.local/bin"
FILE=""
VERSION=""
SERVICE=1

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="${2:?--file needs a path}"; shift 2 ;;
    --version) VERSION="${2:?--version needs x.y.z}"; VERSION="${VERSION#v}"; shift 2 ;;
    --feed) FEED="${2:?--feed needs owner/repo}"; shift 2 ;;
    --no-service) SERVICE=0; shift ;;
    -h | --help)
      echo "usage: install.sh [--file <apx-core-…tar.gz>] [--version x.y.z] [--feed owner/repo] [--no-service]"
      exit 0
      ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=mac ;;
  *) die "this installer is for Linux and macOS; on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) die "no APX bundle for $(uname -m)" ;;
esac

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is needed (install it and run this again)"; }
need tar
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The bundle: the file given, or this platform's from the newest release (or the one asked for).
if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || die "no such file: $FILE"
  NAME="$(basename "$FILE")"
  case "$NAME" in
    apx-core-*-"$OS"-"$ARCH".tar.gz) ;;
    *) die "$NAME is not a bundle for $OS-$ARCH (expected apx-core-<version>-$OS-$ARCH.tar.gz)" ;;
  esac
  VERSION="${NAME#apx-core-}"
  VERSION="${VERSION%-"$OS"-"$ARCH".tar.gz}"
  cp "$FILE" "$WORK/$NAME"
  if [ -f "$FILE.sha256" ]; then cp "$FILE.sha256" "$WORK/$NAME.sha256"; fi
else
  need curl
  if [ -z "$VERSION" ]; then
    say "Looking for the newest APX in $FEED"
    # Newest first; plain vX.Y.Z tags from 2 up (v1's and pre-releases are left out).
    VERSION="$(curl -fsSL -H 'accept: application/vnd.github+json' "https://api.github.com/repos/$FEED/releases?per_page=30" |
      grep -o '"tag_name": *"v[2-9][0-9]*\.[0-9]*\.[0-9]*"' | head -n1 | sed 's/.*"v\([^"]*\)"/\1/')" ||
      true
    [ -n "$VERSION" ] || die "no APX release found in $FEED"
  fi
  NAME="apx-core-$VERSION-$OS-$ARCH.tar.gz"
  BASE="https://github.com/$FEED/releases/download/v$VERSION"
  say "Downloading APX $VERSION ($OS-$ARCH)"
  curl -fL --progress-bar -o "$WORK/$NAME" "$BASE/$NAME" || die "could not download $BASE/$NAME"
  curl -fsSL -o "$WORK/$NAME.sha256" "$BASE/$NAME.sha256" || die "could not download $NAME.sha256"
fi

# 2. Checked against its .sha256 when there is one (always, for a download).
if [ -f "$WORK/$NAME.sha256" ]; then
  want="$(cut -d' ' -f1 <"$WORK/$NAME.sha256" | tr 'A-F' 'a-f')"
  got="$(sha256 "$WORK/$NAME")"
  [ "$want" = "$got" ] || die "$NAME does not match its .sha256 (expected $want, got $got)"
else
  warn "no $NAME.sha256 beside the file: not checked"
fi

# 3. Unpacked beside any version already there, then made current. What ran before stays until the next update.
say "Installing APX $VERSION in $APP"
mkdir -p "$WORK/unpacked" "$APP/versions"
tar -xzf "$WORK/$NAME" -C "$WORK/unpacked"
[ -x "$WORK/unpacked/apx/node/bin/node" ] || die "$NAME has no Node inside"
rm -rf "$APP/versions/$VERSION"
mv "$WORK/unpacked/apx" "$APP/versions/$VERSION"
ln -sfn "versions/$VERSION" "$APP/current.new"
mv -f "$APP/current.new" "$APP/current" 2>/dev/null || {
  rm -rf "$APP/current"
  mv "$APP/current.new" "$APP/current"
}
[ -e "$APP/current" ] || die "could not make $VERSION current"

# 4. APX v1: its daemon stops (two daemons would answer the same Telegram bots) and its `apx` command goes.
if [ -f "$HOME/.config/systemd/user/apx-daemon.service" ]; then
  say "Stopping APX v1's daemon"
  systemctl --user disable --now apx-daemon.service >/dev/null 2>&1 || true
fi
if [ -f "$HOME/Library/LaunchAgents/dev.apx.daemon.plist" ]; then
  say "Stopping APX v1's daemon"
  launchctl bootout "gui/$(id -u)/dev.apx.daemon" >/dev/null 2>&1 || true
fi
if command -v npm >/dev/null 2>&1 && npm ls -g --depth=0 @agentprojectcontext/apx >/dev/null 2>&1; then
  say "Removing APX v1's apx command (its files in ~/.apx stay, to import them)"
  npm uninstall -g @agentprojectcontext/apx >/dev/null 2>&1 || warn "could not remove v1 (npm uninstall -g @agentprojectcontext/apx)"
fi

# 5. The `apx` command, always through `current` so an update is picked up without touching it.
mkdir -p "$BIN"
cat >"$BIN/apx" <<EOF
#!/bin/sh
# The APX command, written by install.sh. APX_APP is where the daemon is installed.
APX_APP="\${APX_APP:-$APP}"
export APX_APP
exec "\$APX_APP/current/node/bin/node" --disable-warning=ExperimentalWarning "\$APX_APP/current/apps/terminal/src/main.ts" "\$@"
EOF
chmod 755 "$BIN/apx"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
      if [ -f "$rc" ] && ! grep -q '.local/bin' "$rc"; then
        printf '\n# Added by the APX installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
      fi
    done
    warn "$BIN was not on your PATH: added to your shell's startup file. Open a new terminal, or run: export PATH=\"$BIN:\$PATH\""
    ;;
esac

# 6. The daemon as a service: started now, at login, and again if it stops (systemd user unit or launchd agent).
if [ "$SERVICE" = 1 ]; then
  say "Starting the APX daemon as a service"
  APX_APP="$APP" "$BIN/apx" service install || warn "the service did not install; run: apx service install"
fi

say "APX $VERSION is installed. Try: apx status"
if [ "$OS" = linux ] && [ "$SERVICE" = 1 ]; then
  echo "    On a server, keep it running after you log out:  sudo loginctl enable-linger $(id -un)"
fi
echo "    To use it from another computer: apx expose tailscale (or lan), then apx pair"
