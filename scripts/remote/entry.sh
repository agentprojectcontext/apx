#!/usr/bin/env bash
# Inside the remote box: the screen, the installs (cached in /cache), then the plan or command.
#   apx-remote-entry plan preflight|verify|…   ·   apx-remote-entry run <command…>
set -uo pipefail
export HOME=/cache/home
mkdir -p "$HOME" /cache/pnpm-store "$PLAYWRIGHT_BROWSERS_PATH"

# The screen: a desktop on :99, watchable at :6080 inside the box (`pnpm remote screen` tunnels to it).
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for _ in $(seq 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
openbox >/tmp/openbox.log 2>&1 &
x11vnc -display :99 -forever -shared -nopw -localhost -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &

step() { printf '\033[2m· %s\033[0m\n' "$*"; }
step "pnpm install"
pnpm install --frozen-lockfile --store-dir /cache/pnpm-store --reporter=silent || exit $?
if [ -f apps/mobile/package-lock.json ]; then
  lock=$(sha1sum apps/mobile/package-lock.json | cut -d' ' -f1)
  if [ "$(cat apps/mobile/node_modules/.apx-lock 2>/dev/null)" != "$lock" ]; then
    step "mobile npm ci"
    (cd apps/mobile && npm ci --no-audit --no-fund --loglevel=error) || exit $?
    echo "$lock" >apps/mobile/node_modules/.apx-lock
  fi
fi
step "playwright chromium"
pnpm exec playwright install chromium >/dev/null || exit $?

kind=${1:-plan}; shift || true
case "$kind" in
  plan) exec node scripts/verify.ts "${1:-preflight}" "${@:2}" ;;
  run) exec bash -c "$*" ;;
  *) echo "unknown: $kind (plan | run)" >&2; exit 2 ;;
esac
