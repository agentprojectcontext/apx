#!/bin/sh
set -eu
# One desktop per screen user. The viewer reaches it only through this user's private socket, and X clients only
# with this user's cookie: another screen's user can neither watch nor type into it.
display="${1:-:1}"
case "$display" in :[0-9]*) ;; *) echo 'display like :101 required' >&2; exit 64 ;; esac
if pgrep -u "$(id -u)" Xtigervnc >/dev/null; then exit 0; fi
umask 077
export DISPLAY="$display" XAUTHORITY="$HOME/.Xauthority"
xauth -q -f "$XAUTHORITY" add "$display" . "$(mcookie)"
socket="$XDG_RUNTIME_DIR/apx-vnc.sock"
rm -f "$socket"
Xtigervnc "$display" -auth "$XAUTHORITY" -geometry 1440x900 -depth 24 -localhost yes -rfbunixpath "$socket" \
  -rfbunixmode 0600 -SecurityTypes None -AlwaysShared -desktop 'APX Computer' > "$HOME/.vnc-screen.log" 2>&1 &
sleep 1
exec dbus-run-session -- startxfce4 > "$HOME/.xfce.log" 2>&1
