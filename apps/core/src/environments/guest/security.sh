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
# The egress rules were written just before this script (guest-security.ts egressRules).
[ -s /etc/apx-computer/egress.nft ]
chown root:root /etc/apx-computer/egress.nft
chmod 600 /etc/apx-computer/egress.nft
install -d -m 755 /usr/local/libexec
cat > /usr/local/libexec/apx-computer-firewall <<'SCRIPT'
#!/bin/sh
set -eu
# Each table is replaced whole and atomically, never duplicated.
load() {
  if nft list table inet "$1" >/dev/null 2>&1; then
    { printf 'delete table inet %s\n' "$1"; cat "$2"; } | nft -f -
  else nft -f "$2"
  fi
}
load apx_computer /etc/apx-computer/egress.nft
# Agents' loopback: a rule names an agent's slice, which must exist before the rule loads.
if [ -f /etc/apx-computer/agents.nft ]; then
  for slice in $(grep -o 'user-[0-9]*\.slice' /etc/apx-computer/agents.nft | sort -u); do systemctl start "$slice"; done
  load apx_loopback /etc/apx-computer/agents.nft
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
# The egress proxy's guest port is PID 1's from boot, before any user's session, so no agent can take it first. Its relay
# reaches the host's tunnel through a socket only the Lima user (uid 1000) can create (egress-tunnel.ts).
cat > /etc/tmpfiles.d/apx-egress.conf <<'CONF'
d /run/apx-egress 0700 1000 1000 -
CONF
systemd-tmpfiles --create /etc/tmpfiles.d/apx-egress.conf
cat > /etc/systemd/system/apx-proxy.socket <<'UNIT'
[Unit]
Description=APX computer egress proxy port
[Socket]
ListenStream=127.0.0.1:3128
FreeBind=yes
[Install]
WantedBy=sockets.target
UNIT
cat > /etc/systemd/system/apx-proxy.service <<'UNIT'
[Unit]
Description=APX computer egress proxy relay
Requires=apx-proxy.socket
After=apx-proxy.socket
[Service]
User=1000
ExecStart=/usr/lib/systemd/systemd-socket-proxyd /run/apx-egress/proxy.sock
UNIT
# An agent runs only while it has a screen: no agent's session comes back by itself when the computer boots.
cat > /etc/systemd/system/apx-agents-boot.service <<'UNIT'
[Unit]
Description=APX agents start only with a screen
DefaultDependencies=no
After=local-fs.target
Before=systemd-logind.service
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'rm -f /var/lib/systemd/linger/apx-a*'
[Install]
WantedBy=systemd-logind.service
UNIT
# Every user's session, the owner's screen and each agent's, waits for the firewall and the proxy's port.
rm -rf /etc/systemd/system/user@1001.service.d
install -d -m 755 /etc/systemd/system/user@.service.d
cat > /etc/systemd/system/user@.service.d/firewall.conf <<'UNIT'
[Unit]
Requires=apx-computer-firewall.service apx-proxy.socket
After=apx-computer-firewall.service apx-proxy.socket
UNIT
systemctl daemon-reload
systemctl enable apx-computer-firewall.service apx-agents-boot.service
systemctl restart apx-computer-firewall.service
systemctl enable --now apx-proxy.socket
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
