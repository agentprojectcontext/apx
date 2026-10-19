#!/bin/sh
set -eu
if pgrep -u "$(id -u)" Xtigervnc >/dev/null; then exit 0; fi
export DISPLAY=:1
Xtigervnc :1 -geometry 1440x900 -depth 24 -localhost yes -SecurityTypes None -AlwaysShared -desktop 'APX Computer' > "$HOME/.vnc-screen.log" 2>&1 &
sleep 1
exec dbus-run-session -- startxfce4 > "$HOME/.xfce.log" 2>&1
