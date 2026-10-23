#!/bin/sh
set -eu
# The Lima administrator and its credentials never share the desktop user's home.
worker=apx-worker
if ! command -v nft >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends nftables
fi
# Older lab desktops ran as the administrator; the protected desktop never shares that session.
pkill -u 1000 -x Xtigervnc 2>/dev/null || true
pkill -u 1000 -x xfce4-session 2>/dev/null || true
if ! id "$worker" >/dev/null 2>&1; then useradd --uid 1001 --create-home --shell /bin/bash "$worker"; fi
[ "$(id -u "$worker")" = 1001 ]
[ "$(id -G "$worker")" = "$(id -g "$worker")" ]
passwd --lock "$worker" >/dev/null
chmod 700 /home/apx-worker
chmod 700 /home/apx /var/lib/cloud /mnt
install -d -m 755 /etc/apx-computer
sudo -n -u "$worker" -H mkdir -p /home/apx-worker/work
if [ -d /home/apx/work ] && [ ! -f /etc/apx-computer/work-imported ]; then
  tar -C /home/apx/work -cf - . | sudo -n -u "$worker" -H sh -c 'cd /home/apx-worker/work && tar --skip-old-files -xf -'
  touch /etc/apx-computer/work-imported
fi
cat > /etc/apx-computer/egress.nft <<'RULES'
table inet apx_computer {
  chain output {
    type filter hook output priority -150; policy accept;
    meta skuid 1001 oifname "lo" accept
    meta skuid 1001 reject with icmpx type admin-prohibited
    meta skuid 2001-2999 oifname "lo" accept
    meta skuid 2001-2999 reject with icmpx type admin-prohibited
  }
  chain forward {
    type filter hook forward priority -150; policy drop;
  }
}
RULES
chmod 600 /etc/apx-computer/egress.nft
install -d -m 755 /usr/local/libexec
cat > /usr/local/libexec/apx-computer-firewall <<'SCRIPT'
#!/bin/sh
set -eu
if nft list table inet apx_computer >/dev/null 2>&1; then
  { printf 'delete table inet apx_computer\n'; cat /etc/apx-computer/egress.nft; } | nft -f -
else nft -f /etc/apx-computer/egress.nft
fi
SCRIPT
chmod 755 /usr/local/libexec/apx-computer-firewall
cat > /etc/systemd/system/apx-computer-firewall.service <<'UNIT'
[Unit]
Description=APX computer egress boundary
Before=user@1001.service
After=local-fs.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/libexec/apx-computer-firewall
[Install]
WantedBy=multi-user.target
UNIT
# Every user's session, the owner's screen and each agent's, waits for the firewall.
rm -rf /etc/systemd/system/user@1001.service.d
install -d -m 755 /etc/systemd/system/user@.service.d
cat > /etc/systemd/system/user@.service.d/firewall.conf <<'UNIT'
[Unit]
Requires=apx-computer-firewall.service
After=apx-computer-firewall.service
UNIT
systemctl daemon-reload
systemctl enable apx-computer-firewall.service
systemctl restart apx-computer-firewall.service
loginctl enable-linger "$worker"
systemctl start user@1001.service
# Lock down optional system helpers as well as sudo, including privileged desktop actions.
install -d -m 755 /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/00-apx-worker.rules <<'RULES'
polkit.addRule(function(action, subject) {
  if (subject.user == "apx-worker" || /^apx-a[0-9]+$/.test(subject.user)) return polkit.Result.NO;
});
RULES
if sudo -n -u "$worker" sudo -n true 2>/dev/null; then echo 'Worker has administrative access' >&2; exit 1; fi
