#!/bin/sh
set -eu
# An agent's screen user: its own locked account and home, no sudo, the same egress firewall as the owner's screen.
n="${1:-}"
case "$n" in '' | *[!0-9]*) echo 'screen number required' >&2; exit 64 ;; esac
[ "$n" -ge 1 ] && [ "$n" -le 999 ]
user="apx-a$n"
uid=$((2000 + n))
if ! id "$user" >/dev/null 2>&1; then useradd --uid "$uid" --create-home --shell /bin/bash "$user"; fi
[ "$(id -u "$user")" = "$uid" ]
[ "$(id -G "$user")" = "$(id -g "$user")" ]
passwd --lock "$user" >/dev/null
chmod 700 "/home/$user"
sudo -n -u "$user" -H mkdir -p "/home/$user/work" "/home/$user/.local/share/apx-vm"
tar -C /usr/local/share/apx-vm -cf - . | sudo -n -u "$user" -H tar -C "/home/$user/.local/share/apx-vm" -xf -
sudo -n -u "$user" -H touch "/home/$user/work/.apx-terminal.log"
loginctl enable-linger "$user"
systemctl start "user@$uid.service"
if sudo -n -u "$user" sudo -n true 2>/dev/null; then echo 'Screen user has administrative access' >&2; exit 1; fi
echo "$user"
