// Loopback between agents: every agent's processes live in its own slice (worker.ts screenArgs, its user manager), so
// a listener is known by the slice of its socket; a new connection to it on lo is refused unless it comes from that
// same agent. Other listeners (the egress proxy, the guest's own services) are untouched (DECISIONS.md#d-152).
import { screenUser } from "./worker.ts";

/** The guest file the firewall loads after the egress rules; rewritten whenever an agent gets a screen. */
export const LOOPBACK_RULES = "/etc/apx-computer/agents.nft";

/** A packet mark per agent: its uid, set on the way out of the sender, read on the way into the listener. */
const mark = (uid: number) => `0x${uid.toString(16).padStart(8, "0")}`;

/** The egress proxy's guest port, the one listener outside an agent an agent may reach on WSL. */
const PROXY_PORT = 3128;

/**
 * WSL's kernel has no socket matching, and its distributions share one network with the owner's others. A connection
 * is marked with the agent that opens it, and its replies are dropped unless listener and caller are the same agent
 * (or the listener is the egress proxy): no one reaches an agent's listeners, and an agent reaches only its own.
 */
function wslRules(users: ReturnType<typeof screenUser>[]): string[] {
  return users.flatMap((u) => [
    `    oifname "lo" ct state new meta skuid ${u.uid} ct mark set ${mark(u.uid)}`,
    `    oifname "lo" ct direction reply meta skuid ${u.uid} ct mark != ${mark(u.uid)} drop`,
    `    oifname "lo" ct direction reply ct mark ${mark(u.uid)} meta skuid != ${u.uid} th sport != ${PROXY_PORT} drop`,
  ]);
}

/** The nftables table for these agent screens; empty of rules when there are none. `wsl`: see wslRules. */
export function agentLoopbackRules(screens: number[], wsl = false): string {
  const users = [...new Set(screens)].sort((a, b) => a - b).map(screenUser);
  if (wsl)
    return [
      "table inet apx_loopback {",
      "  chain output {",
      "    type filter hook output priority -160; policy accept;",
      ...wslRules(users),
      "  }",
      "}",
      "",
    ].join("\n");
  const out = users.map((u) => `    oifname "lo" meta skuid ${u.uid} meta mark set ${mark(u.uid)}`);
  const into = users.map(
    (u) =>
      `    iifname "lo" ct state new socket cgroupv2 level 2 "user.slice/user-${u.uid}.slice" meta mark != ${mark(u.uid)} reject with icmpx type port-unreachable`,
  );
  return [
    "table inet apx_loopback {",
    "  chain output {",
    "    type filter hook output priority -160; policy accept;",
    ...out,
    "  }",
    "  chain input {",
    "    type filter hook input priority -160; policy accept;",
    ...into,
    "  }",
    "}",
    "",
  ].join("\n");
}
