// An agent is called by its name, in every list that offers it.
//
// The "+ New" chat picker and the sidebar's agent filter both printed
// `a.slug` — so they read `arch`, `ceo`, `cfo`, `chro`, `cmo`, `coo` while the
// group picker three blocks below, rendering the SAME array, read Arch, Zoya,
// Blake, Kira. Same screen, same data, two answers.
//
// The bug is old and was invisible until today: before the executive layer
// arrived almost every agent was `rocky`/Rocky, `magui`/Magui — the slug WAS
// the name, capitalisation aside. `AgentEntry` carries `name`, `icon` and
// `emoji` straight from AGENTS.md, so nothing had to be fetched; the data was
// being thrown away one line after it arrived.
//
// The picker also drew a generic <Bot> on every row, which made a list of eight
// agents eight copies of the same picture — and it was the only place in the
// panel that did, against "one AgentAvatar per agent, everywhere".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const list = fs.readFileSync(path.join(ROOT, "src/interfaces/web/src/components/chat/ChatList.tsx"), "utf8");

/** Every `agents.map(...)` in the file, so a new list cannot quietly join the
 *  two that were wrong. */
function agentMaps() {
  const out = [];
  const re = /agents\.map\(\(a\) => \(\{/g;
  let m;
  while ((m = re.exec(list))) {
    // Take the object literal that follows, up to its closing `})`.
    const end = list.indexOf("})", m.index);
    out.push(list.slice(m.index, end));
  }
  return out;
}

test("every list built from the project's agents labels them by name", () => {
  const maps = agentMaps();
  assert.ok(maps.length >= 2, "the pickers and the filter are all built this way");
  for (const block of maps) {
    assert.doesNotMatch(
      block,
      /label:\s*a\.slug\b/,
      `a slug is an address, not a name:\n${block}`,
    );
    assert.match(block, /a\.name \|\| a\.slug/, `fall back to the slug only when there is no name:\n${block}`);
  }
});

test("the new-chat picker draws the agent's own face", () => {
  // Not a generic glyph. The group picker beside it already did this; the two
  // rendering the same agents differently is the whole complaint.
  assert.match(list, /<AgentAvatar \{\.\.\.a\.face\} size=\{18\} \/>/);
  assert.match(list, /face: \{ icon: a\.icon, emoji: a\.emoji, name: a\.name \|\| a\.slug \}/);
  // And the super-agent gets its configured icon rather than falling through to
  // the same placeholder.
  assert.match(list, /face: \{ icon: superAgentIcon, name: superAgentLabel \}/);
});

test("the group picker, which was already right, stays right", () => {
  assert.match(list, /<AgentAvatar icon=\{a\.icon\} emoji=\{a\.emoji\} name=\{a\.name \|\| a\.slug\} size=\{18\} \/>/);
});
