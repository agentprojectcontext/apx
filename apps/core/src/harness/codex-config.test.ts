import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { codexOverrides, codexServerNames } from "./codex.ts";

test("an APX turn runs Codex with APX's tools only: the owner's servers, plugins and Codex's own tools stay off", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-codex-home-"));
  fs.writeFileSync(
    path.join(home, "config.toml"),
    '[mcp_servers.node_repl]\ncommand = "node"\n[mcp_servers.node_repl.env]\nTOKEN = "x"\n[mcp_servers."crm-tools"]\nurl = "https://example.com"\n[plugins.foo]\nenabled = true\n',
  );
  const servers = codexServerNames(home);
  assert.deepEqual(servers, ["node_repl", "crm-tools"]);
  const apx = { command: "node", args: ["mcp"], env: {} };
  const chat = codexOverrides({ coding: false, servers, apx });
  assert.deepEqual(chat.mcp_servers, { node_repl: { enabled: false }, "crm-tools": { enabled: false }, apx });
  const features = chat.features as Record<string, boolean>;
  for (const f of [
    "shell_tool",
    "unified_exec",
    "plugins",
    "browser_use",
    "computer_use",
    "multi_agent",
    "skill_search",
  ])
    assert.equal(features[f], false, f);
  assert.equal(chat.web_search, "disabled");
  assert.equal(chat.project_doc_max_bytes, 0, "the owner's AGENTS.md files are not Codex's instructions here");
  const code = codexOverrides({ coding: true, servers, apx }).features as Record<string, boolean>;
  assert.equal(code.shell_tool, undefined, "a code thread keeps commands and edits");
  assert.equal(code.plugins, false);
  assert.deepEqual(codexServerNames(path.join(home, "nope")), []);
  fs.rmSync(home, { recursive: true, force: true });
});
