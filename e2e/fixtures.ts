// The world the e2e core lives in, written into a temp folder: an APX v1 to import (a project with an agent, tasks,
// a routine, notes, a variable, a skill), a Claude Code and a Codex session to resume, and a project folder of its own.
import fs from "node:fs";
import path from "node:path";

const write = (file: string, v: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v, null, 2));
};
const lines = (...rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

export function writeFixtures(dir: string) {
  const home = path.join(dir, "apx-home");
  const v1 = path.join(dir, "apx-v1");
  const claude = path.join(dir, "claude");
  const codex = path.join(dir, "codex");
  const repo = path.join(dir, "work", "acme");
  const legacy = path.join(dir, "work", "northwind");
  fs.mkdirSync(home, { recursive: true });

  // A project of its own (not in v1): the one tests register by hand.
  write(path.join(repo, "AGENTS.md"), "# Acme\n\nThe Acme storefront.\n");
  write(path.join(repo, "README.md"), "# Acme\n\nA small shop.\n");
  write(path.join(repo, "src", "index.ts"), "export const hello = () => 'hi';\n");
  // A plain folder (no AGENTS.md): added from the sidebar later.
  write(path.join(dir, "work", "globex", "notes.txt"), "Globex notes.\n");

  // APX v1, as it leaves its folder.
  write(path.join(legacy, "AGENTS.md"), "# Northwind\n");
  write(path.join(legacy, ".apc", "project.json"), { name: "Northwind", apx_id: "nw0000000001" });
  write(path.join(legacy, ".apc", "agents", "dev.md"), "---\nname: Dev\nrole: developer\n---\nYou build.\n");
  write(path.join(legacy, ".apc", "agents", "ops.md"), "---\nname: Ops\nrole: operations\n---\nYou deploy.\n");
  write(path.join(v1, "config.json"), { projects: [{ path: legacy }] });
  write(path.join(v1, "update-check.json"), { current: "1.120.0" });
  write(path.join(v1, "identity.json"), { agent_name: "Roby", owner_name: "Ana" });
  write(path.join(v1, "vars.json"), { NORTHWIND_API: "nw-e2e-value" });
  write(path.join(v1, "skills", "brief", "SKILL.md"), "---\nname: brief\ndescription: Write a brief.\n---\nHow.\n");
  write(path.join(v1, "memory.md"), "## 2026-09-01\n- [09:00][app] Ana prefers short answers\n");
  const storage = path.join(v1, "projects", "nw0000000001");
  write(path.join(storage, "memory.md"), "## 2026-09-02\n- [11:00][app] Deploys go out on Fridays\n");
  write(
    path.join(storage, "tasks", "2026-09.jsonl"),
    lines(
      { id: "t1", op: "create", ts: "2026-09-01T10:00:00Z", title: "Ship the invoice page", priority: "high" },
      { id: "t2", op: "create", ts: "2026-09-01T10:01:00Z", title: "Old chore" },
      { id: "t2", op: "done", ts: "2026-09-02T10:00:00Z" },
    ),
  );
  write(path.join(storage, "routines.json"), {
    routines: [{ name: "Morning brief", kind: "exec_agent", schedule: "0 9 * * *", spec: { prompt: "Brief me." } }],
  });

  // A Claude Code session and a Codex one the owner started outside APX.
  write(
    path.join(claude, "projects", "-work-acme", "11111111-2222-3333-4444-555555555555.jsonl"),
    lines(
      { type: "user", cwd: repo, message: { role: "user", content: "Refactor the cart module" } },
      { type: "assistant", cwd: repo, message: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
    ),
  );
  write(
    path.join(codex, "sessions", "2026", "09", "30", "rollout-2026-09-30T10-00-00-cdx1.jsonl"),
    lines(
      { type: "session_meta", payload: { id: "cdx1", cwd: repo, originator: "codex_cli_rs" } },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Add a footer" }] },
      },
    ),
  );
  return { home, v1, claude, codex, repo };
}
