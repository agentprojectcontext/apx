import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { card, cells, failure, portrait, readTheme, rememberTheme, unreachableCore } from "./presentation.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-cli-brand-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));

const cli = (...args: string[]) =>
  spawnSync(process.execPath, [fileURLToPath(new URL("./main.ts", import.meta.url)), ...args], {
    encoding: "utf8",
    env: { ...process.env, APX_URL: "http://127.0.0.1:1", APX_HOME: home },
    timeout: 10_000,
  });

test("version and help work offline, including short flags and JSON", () => {
  for (const flag of ["--version", "-v"]) {
    const r = cli(flag);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /APX v2/);
    assert.ok(!r.stdout.includes("0.0.0"));
  }
  const r = cli("--version", "--json");
  assert.equal(JSON.parse(r.stdout).generation, 2);
  assert.match(cli("--help").stdout, /apx mcp run/);
});

test("the help the top-level help advertises is help, not an error", () => {
  for (const command of ["routines", "tasks", "channels", "owner", "org", "profiles", "service", "init", "mcps"]) {
    const r = cli(command, "help");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^apx ${command}`));
    assert.equal(r.stderr, "");
  }
});

test("unknown options and commands fail with useful errors and no stack trace", () => {
  const option = cli("--unknown-option");
  assert.equal(option.status, 2);
  assert.match(option.stderr, /Invalid arguments/);
  assert.ok(!option.stderr.includes("at parseArgs"));
  const command = cli("unknown-command");
  assert.equal(command.status, 1);
  assert.match(command.stderr, /404/);
});

test("with --plain an error is one line with the message, for scripts and agents", () => {
  const r = cli("agents", "model", "superagent", "--plain");
  assert.equal(r.status, 1);
  assert.equal(
    r.stderr.trim(),
    "apx: APX · Error: usage: apx agents model <agent> <engine/model|engine|router|default> [--router]",
  );
  assert.equal(
    failure("APX · not_found", ["agent \u001b[2Jx not found"], true),
    "apx: APX · not_found: agent  [2Jx not found",
  );
});

test("cards remove untrusted terminal control characters and fit narrow output", () => {
  const output = card("Error", ["unsafe\u001b[2J title\nline"], 40);
  assert.ok(!output.includes("\u001b"));
  assert.ok(output.split("\n").every((s) => s.length <= 40));
  assert.ok(portrait("noche").length > 0);
});

test("blob cards keep alignment in color, Unicode and narrow terminals", () => {
  for (const columns of [24, 40, 80, 100]) {
    const output = card(
      "Status",
      ["A crew 🟢 online", "界 · Devices", "Café"],
      columns,
      undefined,
      { name: "Northwind 🟢", blob: "noche" },
      true,
    );
    const plain = stripVTControlCharacters(output);
    const widths = plain.split("\n").map(cells);
    assert.ok(
      widths.every((n) => n === widths[0]),
      JSON.stringify(widths),
    );
    assert.ok(widths[0] !== undefined && widths[0] <= columns);
    assert.match(output, /38;2;/);
  }
});

test("help and errors preserve the selected blob offline without coloring machine output", () => {
  rememberTheme(home, { name: "Northwind", blob: "noche" });
  assert.deepEqual(readTheme(home), { name: "Northwind", blob: "noche" });
  const help = cli("--help");
  assert.match(help.stdout, /Seeing Help/);
  assert.ok(!help.stdout.includes("Northwind"));
  assert.ok(!help.stdout.includes("\u001b"));
  const error = cli("missing");
  assert.match(error.stderr, /Your crew, on your machine/);
  assert.ok(!error.stderr.includes("Northwind"));
  const plain = cli("--help", "--plain");
  assert.ok(!plain.stdout.includes("╭"));
  assert.match(plain.stdout, /Usage:/);
});

test("daemon explains the service command without acting as an alias", () => {
  const r = cli("daemon");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /apx service status/);
  assert.match(r.stderr, /apx service restart/);
});

test("a core that cannot be reached is explained: not running, or blocked by a sandbox", async () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:7440"), { code: "ECONNREFUSED" });
  const blocked = Object.assign(new Error("connect EPERM 127.0.0.1:7440"), { code: "EPERM" });
  const denied = Object.assign(new Error("connect EACCES 127.0.0.1:7440"), { code: "EACCES" });
  const fetchFailed = (cause: unknown) => new TypeError("fetch failed", { cause });
  assert.equal(unreachableCore(fetchFailed(refused))?.title, "Core not running");
  assert.equal(unreachableCore(fetchFailed(new AggregateError([refused, refused])))?.title, "Core not running");
  for (const err of [fetchFailed(blocked), fetchFailed(denied), fetchFailed(new AggregateError([refused, blocked]))])
    assert.match(unreachableCore(err)?.lines.join(" ") ?? "", /sandbox/);
  assert.equal(unreachableCore(fetchFailed(new Error("bad port"))), undefined);
  assert.equal(unreachableCore(new Error("boom")), undefined);
  assert.equal(unreachableCore("boom"), undefined);

  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./main.ts", import.meta.url)), "status", "--plain"], {
    encoding: "utf8",
    env: { ...process.env, APX_URL: `http://127.0.0.1:${port}`, APX_HOME: home },
    timeout: 10_000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Core not running/);
});
