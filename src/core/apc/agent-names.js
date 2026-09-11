// Names for agents, so a team reads like a team and not like an org chart.
//
// The slug is the identity — `cfo` is what a Parent points at, what a2a
// addresses, what the file is called. The NAME is what a person sees, and
// "cfo / cfo" tells them nothing twice. A name plus a greyed-out role ("Nora ·
// Chief Financial Officer") tells them who to talk to AND what they do.
//
// The pool is picked from at INSTALL time, never at render time: a dialog that
// shows a different name every time it opens is a dialog nobody trusts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
export const NAMES_FILE = path.resolve(__dir, "../../../assets/agent-names.json");

let cached = null;

export function agentNamePool() {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(fs.readFileSync(NAMES_FILE, "utf8"));
    cached = Array.isArray(parsed?.names) ? parsed.names : [];
  } catch {
    cached = [];
  }
  return cached;
}

/**
 * A name nobody on this machine is using.
 *
 * `taken` is every agent name already in play — across every project, not just
 * this one, because two agents called Nora in two companies is exactly the
 * confusion this avoids when they both show up in one inbox.
 *
 * Deterministic given the same inputs: the first free name in pool order. When
 * the pool runs dry it numbers, rather than returning null and making the
 * caller invent something.
 */
export function pickAgentName(taken = [], { seed = null } = {}) {
  const used = new Set(
    [...taken].filter(Boolean).map((n) => String(n).trim().toLowerCase()),
  );
  const pool = agentNamePool();
  if (!pool.length) return seed || "Agent";

  const start = seed ? Math.abs(hash(seed)) % pool.length : 0;
  for (let i = 0; i < pool.length; i += 1) {
    const name = pool[(start + i) % pool.length];
    if (!used.has(name.toLowerCase())) return name;
  }
  for (let n = 2; ; n += 1) {
    const name = `${pool[start]} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

// Small stable hash so a given slug lands on the same place in the pool every
// time — two installs of the same template on two machines read alike.
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}
