// `apx agent set --autonomy` — the field the panel could write and the CLI
// could not.
//
// 2026-09-20: an agent with every tool, its skills and "full auto" inherited
// refused to write a single file, and told the owner it had "sent the
// confirmation requests" for work that never happened. Nothing was broken. Its
// own `Autonomy: automatico` was overriding the global `total`, and a routine
// or a group room has no confirmation dialog to send a request to — so the only
// honest outcome was a refusal, and the only fix was a dropdown in the web.
//
// Which meant the one setting that decides whether an agent can act was
// unreachable from a terminal, from a script, and from the agent skill the
// super-agent follows to build its own team.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initApf } from "#core/apc/scaffold.js";
import { readAgents } from "#core/apc/parser.js";
import { cmdAgentAdd, cmdAgentSet } from "#interfaces/cli/commands/agent.js";
import { applyAgentAutonomy } from "#core/agent/run-turn.js";

async function inProject(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-agent-auto-")));
  const cwd = process.cwd();
  initApf(root, { name: "Demo" });
  try {
    process.chdir(root);
    await fn(root);
  } finally {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const args = (positional, flags) => ({ _: positional, flags });
const agent = (root, slug) => readAgents(root).find((a) => a.slug === slug);

test("agent add --autonomy writes it, and omitting it leaves the agent inheriting", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["productor"], { role: "Producer", autonomy: "total" }));
    assert.equal(agent(root, "productor").fields.Autonomy, "total");

    await cmdAgentAdd(args(["callado"], { role: "Quiet" }));
    assert.equal(
      agent(root, "callado").fields.Autonomy,
      undefined,
      "no flag ⇒ no field: the agent follows the project, it does not freeze today's mode",
    );
  });
});

test("agent set --autonomy is what unblocks an agent that cannot be asked", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["productor"], { role: "Producer", prompt: "Hacé reels." }));
    await cmdAgentSet(args(["productor"], { autonomy: "automatico" }));

    // The condition the screenshot showed: global total, agent automatico, and
    // the agent is the one that wins.
    const gated = applyAgentAutonomy(
      { super_agent: { permission_mode: "total" } },
      agent(root, "productor"),
    );
    assert.equal(gated.super_agent.permission_mode, "automatico", "the agent overrides the global mode");

    await cmdAgentSet(args(["productor"], { autonomy: "total" }));
    const freed = applyAgentAutonomy(
      { super_agent: { permission_mode: "automatico" } },
      agent(root, "productor"),
    );
    assert.equal(freed.super_agent.permission_mode, "total", "and it overrides it the other way too");
  });
});

test("agent set --autonomy inherit removes the field instead of writing a word for it", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["productor"], { role: "Producer", autonomy: "permiso" }));
    await cmdAgentSet(args(["productor"], { autonomy: "inherit" }));

    assert.equal(agent(root, "productor").fields.Autonomy, undefined);
    const cfg = applyAgentAutonomy(
      { super_agent: { permission_mode: "total" } },
      agent(root, "productor"),
    );
    assert.equal(cfg.super_agent.permission_mode, "total", "back to following the project");
  });
});

test("a typo is refused, not dropped — the one direction where failing open is dangerous", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["productor"], { role: "Producer" }));
    await assert.rejects(
      () => cmdAgentSet(args(["productor"], { autonomy: "totl" })),
      /invalid --autonomy .*total, automatico, permiso/,
      "`Updated productor` over a field that was never written is the worst outcome here",
    );
    assert.equal(agent(root, "productor").fields.Autonomy, undefined, "and nothing was written");
  });
});

test("agent set --name renames what every surface shows, and the slug stays the address", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["productor"], { name: "Pepe", role: "Producer" }));
    await cmdAgentSet(args(["productor"], { name: "Paula" }));

    const a = agent(root, "productor");
    assert.equal(a.fields.Name, "Paula");
    assert.equal(a.slug, "productor", "the slug is identity — renaming is not moving");
  });
});

test("agent set --master gives the crown without changing what the agent IS", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["lider"], { role: "Assistant", type: "assistant" }));
    await cmdAgentSet(args(["lider"], { master: true }));

    const a = agent(root, "lider");
    // Frontmatter is text: the parser hands back "true", which is why every
    // reader of this field compares strings (see is_master in the daemon API).
    assert.equal(String(a.fields.Master).toLowerCase(), "true");
    assert.equal(a.fields.Type, "assistant", "a lead is not automatically an orchestrator");

    await cmdAgentSet(args(["lider"], { "no-master": true }));
    const after = agent(root, "lider").fields;
    assert.equal(after.Master, undefined);
    assert.equal(after.Primary, undefined, "the older spelling goes too, or is_master still reads true");
  });
});
