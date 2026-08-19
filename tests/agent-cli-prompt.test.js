// `apx agent add` / `apx agent set` must be able to write the agent's SYSTEM
// PROMPT — the body of `.apc/agents/<slug>.md`, injected by buildAgentSystem()
// as "# Custom instructions".
//
// Regression guard for a silent failure: the CLI wrote frontmatter only (no
// flag existed, and writeAgentFile's 4th argument was never passed), exited 0,
// and left the agent running on three metadata fields with no instructions at
// all — while the daemon API and web UI could always write it via `system`.
// The super-agent, following the apx-agent skill, created agents this way.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initApf } from "#core/apc/scaffold.js";
import { readAgents } from "#core/apc/parser.js";
import { cmdAgentAdd, cmdAgentSet } from "#interfaces/cli/commands/agent.js";
import { DEFAULT_AGENT_TOOLS } from "#core/http-tools/catalog.js";
import { SUPER_AGENT_BLOB, isBlobKey } from "#core/apc/agent-identity.js";

const PROMPT = [
  "You are the reviewer for this project.",
  "",
  "## Hard limits",
  "- Never approve a diff you could not explain back.",
].join("\n");

// The commands are cwd-scoped (findApfRoot walks up from process.cwd()).
async function inProject(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-agent-cli-")));
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

function args(positional, flags) {
  return { _: positional, flags };
}

function bodyOf(root, slug) {
  return readAgents(root).find((a) => a.slug === slug)?.body || "";
}

test("agent add --prompt writes the system prompt into the file body", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["reviewer"], { role: "Code reviewer", prompt: PROMPT }));

    const raw = fs.readFileSync(path.join(root, ".apc", "agents", "reviewer.md"), "utf8");
    assert.match(raw, /^---\n/);
    assert.match(raw, /role: Code reviewer/);
    // The prompt is the BODY, after the frontmatter — not a frontmatter field.
    assert.ok(raw.includes(PROMPT), "prompt text must be in the file");
    assert.equal(bodyOf(root, "reviewer"), PROMPT);
  });
});

test("agent add --prompt-file reads the prompt from disk", async () => {
  await inProject(async (root) => {
    const file = path.join(root, "prompt.md");
    fs.writeFileSync(file, PROMPT + "\n");
    await cmdAgentAdd(args(["reviewer"], { "prompt-file": file }));
    assert.equal(bodyOf(root, "reviewer"), PROMPT);
  });
});

test("agent add --prompt-file on a missing file fails loudly", async () => {
  await inProject(async () => {
    await assert.rejects(
      () => cmdAgentAdd(args(["reviewer"], { "prompt-file": "/nope/nope.md" })),
      /no such file/,
    );
  });
});

// The old behaviour, kept reachable but no longer silent: the command still
// succeeds without a prompt (scripts depend on it), and now says so.
test("agent add with no prompt still works but warns", async () => {
  await inProject(async (root) => {
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(" "));
    try {
      await cmdAgentAdd(args(["magui"], { role: "Social Media Producer", description: "Productora." }));
    } finally {
      console.log = log;
    }
    assert.equal(bodyOf(root, "magui"), "");
    const out = lines.join("\n");
    assert.match(out, /no system prompt/);
    assert.match(out, /apx agent set magui --prompt/);
  });
});

// Matches the daemon API, which has always applied DEFAULT_AGENT_TOOLS on
// create. A CLI-created agent used to land with no tools at all.
test("agent add defaults tools to the safe set, and --tools overrides it", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["reviewer"], { prompt: PROMPT }));
    const fields = readAgents(root).find((a) => a.slug === "reviewer").fields;
    const tools = String(fields.Tools).split(",").map((s) => s.trim());
    assert.deepEqual(tools, [...DEFAULT_AGENT_TOOLS]);

    await cmdAgentAdd(args(["narrow"], { prompt: PROMPT, tools: "read_file, glob" }));
    const narrow = readAgents(root).find((a) => a.slug === "narrow").fields;
    assert.deepEqual(String(narrow.Tools).split(",").map((s) => s.trim()), ["read_file", "glob"]);
  });
});

// Every agent gets a face. A CLI-created agent used to have no Icon at all and
// rendered as a grey lettered disc in the web, the inbox and every bubble.
test("agent add assigns a blob avatar, and picks a different one per agent", async () => {
  await inProject(async (root) => {
    for (const slug of ["uno", "dos", "tres"]) {
      await cmdAgentAdd(args([slug], { prompt: PROMPT }));
    }
    const icons = readAgents(root).map((a) => a.fields.Icon);
    assert.equal(icons.length, 3);
    for (const icon of icons) {
      assert.ok(isBlobKey(icon), `"${icon}" is not a blob key`);
      // Reserved for the super-agent.
      assert.notEqual(icon, SUPER_AGENT_BLOB);
    }
    assert.equal(new Set(icons).size, 3, "each agent should get its own blob");
  });
});

test("agent add --icon pins a blob and rejects an unknown one", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["uno"], { prompt: PROMPT, icon: "kiwi" }));
    assert.equal(readAgents(root).find((a) => a.slug === "uno").fields.Icon, "kiwi");

    await assert.rejects(
      () => cmdAgentAdd(args(["dos"], { prompt: PROMPT, icon: "banana" })),
      /invalid --icon/,
    );
  });
});

test("agent add slugifies a display-name area so Growth and growth don't split", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["max"], { prompt: PROMPT, area: "Growth" }));
    assert.equal(readAgents(root).find((a) => a.slug === "max").fields.Area, "growth");
  });
});

test("agent add takes a typology and an area, and rejects an unknown type", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["magui"], {
      prompt: PROMPT, type: "specialist", area: "growth", role: "Social Media Producer",
    }));
    const f = readAgents(root).find((a) => a.slug === "magui").fields;
    assert.equal(f.Type, "specialist");
    assert.equal(f.Area, "growth");
    assert.equal(f.Role, "Social Media Producer");

    await assert.rejects(
      () => cmdAgentAdd(args(["nope"], { prompt: PROMPT, type: "wizard" })),
      /invalid --type "wizard"/,
    );
  });
});

// The web sets is_master when the type is orchestrator; the CLI must agree or
// the hierarchy view and the typology tell two different stories.
test("agent add --type orchestrator also marks the agent as master", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["roby"], { prompt: PROMPT, type: "orchestrator" }));
    const f = readAgents(root).find((a) => a.slug === "roby").fields;
    assert.equal(f.Type, "orchestrator");
    assert.equal(String(f.Master), "true");
  });
});

test("agent set can change the typology and the avatar", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["magui"], { prompt: PROMPT }));
    await cmdAgentSet(args(["magui"], { type: "worker", icon: "saturno", area: "content" }));

    const f = readAgents(root).find((a) => a.slug === "magui").fields;
    assert.equal(f.Type, "worker");
    assert.equal(f.Icon, "saturno");
    assert.equal(f.Area, "content");
    // …and the prompt survived the identity edit.
    assert.equal(bodyOf(root, "magui"), PROMPT);
  });
});

test("agent set --prompt gives instructions to an agent created without them", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["magui"], { role: "Social Media Producer" }));
    assert.equal(bodyOf(root, "magui"), "");

    await cmdAgentSet(args(["magui"], { prompt: PROMPT }));
    assert.equal(bodyOf(root, "magui"), PROMPT);
    // The fields it already had survive the prompt write.
    assert.equal(readAgents(root).find((a) => a.slug === "magui").fields.Role, "Social Media Producer");
  });
});

test("agent set on a field leaves the existing prompt untouched", async () => {
  await inProject(async (root) => {
    await cmdAgentAdd(args(["reviewer"], { prompt: PROMPT }));
    await cmdAgentSet(args(["reviewer"], { model: "zen:big-pickle" }));

    assert.equal(bodyOf(root, "reviewer"), PROMPT);
    assert.equal(readAgents(root).find((a) => a.slug === "reviewer").fields.Model, "zen:big-pickle");
  });
});

test("agent set refuses a no-op and an unknown slug", async () => {
  await inProject(async () => {
    await cmdAgentAdd(args(["reviewer"], { prompt: PROMPT }));
    await assert.rejects(() => cmdAgentSet(args(["reviewer"], {})), /nothing to change/);
    await assert.rejects(() => cmdAgentSet(args(["ghost"], { prompt: "x" })), /not found/);
  });
});
