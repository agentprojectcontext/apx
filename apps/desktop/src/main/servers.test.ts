import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import type { Connection } from "./connection.ts";
import {
  loadServers,
  MAX_REMOTE_SERVERS,
  nameServer,
  rememberServer,
  serverHost,
  serverId,
  serverViews,
} from "./servers.ts";

const tempData = (t: { after: (fn: () => void) => void }) => {
  const dir = tempDir("apx-servers-");
  t.after(dir.remove);
  return dir.path;
};
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
const url = (n: number): Connection => ({ mode: "url", url: `https://box${n}.example.com` });

test("each server used goes first, once, and keeps the name its core reported", (t) => {
  const dir = tempData(t);
  assert.deepEqual(loadServers(dir), []);
  rememberServer(dir, { mode: "local" }, at(1));
  rememberServer(dir, { mode: "url", url: "https://apx.example.com" }, at(2));
  rememberServer(dir, { mode: "ssh", target: "ops@box.example.com:2222" }, at(3));
  nameServer(dir, { mode: "url", url: "https://apx.example.com" }, "  Northwind\u0000 box\n");
  rememberServer(dir, { mode: "url", url: "https://apx.example.com" }, at(4));
  const servers = loadServers(dir);
  assert.deepEqual(
    servers.map((s) => serverId(s.connection)),
    ["url:https://apx.example.com", "ssh:ops@box.example.com:2222", "local"],
  );
  assert.equal(servers[0]?.name, "Northwind box");
  assert.equal(servers[0]?.used_at, at(4).toISOString());
});

test("only the newest remote servers are kept, and this computer's own is never pushed out", (t) => {
  const dir = tempData(t);
  rememberServer(dir, { mode: "local" }, at(0));
  for (let n = 1; n <= MAX_REMOTE_SERVERS + 3; n++) rememberServer(dir, url(n), at(n));
  const servers = loadServers(dir);
  assert.equal(servers.length, MAX_REMOTE_SERVERS + 1);
  assert.deepEqual(servers[0]?.connection, url(MAX_REMOTE_SERVERS + 3));
  assert.ok(servers.some((s) => s.connection.mode === "local"));
  assert.ok(!servers.some((s) => serverId(s.connection) === "url:https://box1.example.com"));
});

test("a broken or tampered list is read like connection.json: entries that fail are dropped, never connected to", (t) => {
  const dir = tempData(t);
  const file = path.join(dir, "servers.json");
  fs.writeFileSync(file, "{ not json");
  assert.deepEqual(loadServers(dir), []);
  fs.writeFileSync(file, JSON.stringify({ connection: { mode: "local" } }));
  assert.deepEqual(loadServers(dir), []);
  const used_at = at(1).toISOString();
  fs.writeFileSync(
    file,
    JSON.stringify([
      { connection: { mode: "ssh", target: "-oProxyCommand=evil" }, used_at },
      { connection: { mode: "ssh", target: "user@host; rm -rf ~" }, used_at },
      { connection: { mode: "url", url: "file:///etc/passwd" }, used_at },
      { connection: { mode: "url", url: "https://apx.example.com/some/path" }, used_at },
      { connection: { mode: "local", home: "relative/home", port: 7440, home_id: "x" }, used_at },
      { connection: { mode: "url", url: "https://apx.example.com" }, used_at: "yesterday" },
      { connection: { mode: "url", url: "https://apx.example.com" }, used_at, name: 42 },
      { connection: { mode: "url", url: "https://apx.example.com" }, used_at: at(0).toISOString(), name: "Twice" },
      { connection: { mode: "mail", to: "user@example.com" }, used_at },
      null,
    ]),
  );
  assert.deepEqual(loadServers(dir), [{ connection: { mode: "url", url: "https://apx.example.com" }, used_at }]);
  // Something no connection would have saved is not remembered either.
  rememberServer(dir, { mode: "url", url: "javascript:alert(1)" }, at(5));
  assert.equal(loadServers(dir).length, 1);
});

test("a name is kept only for a server already in the list, and only as plain short text", (t) => {
  const dir = tempData(t);
  nameServer(dir, url(1), "Acme");
  assert.deepEqual(loadServers(dir), []);
  rememberServer(dir, url(1), at(1));
  for (const bad of [undefined, 7, "   ", "‮"]) nameServer(dir, url(1), bad);
  assert.equal(loadServers(dir)[0]?.name, undefined);
  nameServer(dir, url(1), "x".repeat(500));
  assert.equal(loadServers(dir)[0]?.name?.length, 80);
});

test("the list names each by its host, probes all but the one in use and never asks over SSH", async () => {
  assert.equal(serverHost({ mode: "url", url: "http://192.168.1.20:7440" }), "192.168.1.20:7440");
  assert.equal(serverHost({ mode: "ssh", target: "ops@box.example.com:2222" }), "box.example.com");
  assert.equal(serverHost({ mode: "local" }), undefined);
  const servers = [
    { connection: url(1), name: "Northwind", used_at: at(3).toISOString() },
    { connection: { mode: "ssh", target: "ops@box.example.com" } as Connection, used_at: at(2).toISOString() },
    { connection: { mode: "local" } as Connection, used_at: at(1).toISOString() },
  ];
  const probed: string[] = [];
  const probe = async (c: Connection) => {
    probed.push(serverId(c));
    if (c.mode === "ssh") return undefined;
    if (c.mode === "local") throw new Error("down");
    return true;
  };
  const views = await serverViews(servers, url(2), probe);
  assert.deepEqual(views, [
    { id: "url:https://box2.example.com", kind: "remote", host: "box2.example.com", current: true },
    {
      id: "url:https://box1.example.com",
      kind: "remote",
      name: "Northwind",
      host: "box1.example.com",
      current: false,
      online: true,
    },
    { id: "ssh:ops@box.example.com", kind: "remote", host: "box.example.com", current: false },
    { id: "local", kind: "local", current: false, online: false },
  ]);
  assert.ok(!probed.includes("url:https://box2.example.com"));
  const inUse = await serverViews(servers, { mode: "local" }, probe);
  assert.deepEqual(
    inUse.map((v) => [v.id, v.current]),
    [
      ["url:https://box1.example.com", false],
      ["ssh:ops@box.example.com", false],
      ["local", true],
    ],
  );
});

test("a list that cannot be written never stops a connection from being chosen", (t) => {
  const dir = tempData(t);
  const blocked = path.join(dir, "not-a-folder");
  fs.writeFileSync(blocked, "");
  assert.doesNotThrow(() => rememberServer(blocked, url(1), at(1)));
  assert.doesNotThrow(() => nameServer(blocked, url(1), "Acme"));
  assert.deepEqual(loadServers(blocked), []);
});
