import assert from "node:assert/strict";
import { test } from "node:test";
import type { T } from "../i18n/index.ts";
import { serverRows } from "./serverRows.ts";

// The key and its values, so each case reads which text the row shows.
const t: T = (key, vars) => (vars ? `${key}(${Object.values(vars).join(",")})` : key);

test("a browser has no list: only the server in use shows, named by its computer once the core says it", () => {
  const here = { local: true, online: true, host: "127.0.0.1" };
  const plain = serverRows(undefined, here, t);
  assert.deepEqual(plain.local, [
    { id: "current", local: true, title: "server.local", sub: "server.thisComputer", dot: "on", current: true },
  ]);
  assert.deepEqual(plain.remote, []);
  assert.equal(
    serverRows(undefined, { ...here, machine: "Acme laptop" }, t).current.sub,
    "server.thisComputerNamed(Acme laptop)",
  );
  assert.equal(serverRows(undefined, { ...here, online: false }, t).current.sub, "server.offline");
  const remote = serverRows(undefined, { local: false, online: true, host: "apx.example.com" }, t).current;
  assert.deepEqual([remote.title, remote.sub], ["apx.example.com", "server.remote"]);
  const named = serverRows(undefined, { local: false, online: true, host: "apx.example.com", machine: "Northwind" }, t);
  assert.deepEqual([named.current.title, named.current.sub], ["Northwind", "server.remoteSub(apx.example.com)"]);
});

test("the desktop list puts this computer under Local and the rest under Remote, with what is really known", () => {
  const rows = serverRows(
    [
      { id: "ssh:ops@box.example.com", kind: "remote", host: "box.example.com", current: true },
      {
        id: "url:https://apx.example.com",
        kind: "remote",
        name: "Northwind",
        host: "apx.example.com",
        current: false,
        online: true,
      },
      { id: "url:https://old.example.com", kind: "remote", host: "old.example.com", current: false, online: false },
      { id: "ssh:ops@far.example.com", kind: "remote", host: "far.example.com", current: false },
      { id: "local", kind: "local", name: "Acme laptop", current: false, online: false },
    ],
    // Over SSH the page is on a local forward: its own host says nothing of where the server is.
    { local: false, online: true, host: "127.0.0.1" },
    t,
  );
  assert.deepEqual(rows.local, [
    { id: "local", local: true, title: "server.local", sub: "server.thisComputerOffline", dot: "off", current: false },
  ]);
  assert.deepEqual(
    rows.remote.map((r) => [r.title, r.sub, r.dot, r.current]),
    [
      ["box.example.com", "server.remote", "on", true],
      ["Northwind", "server.remoteSub(apx.example.com)", "on", false],
      ["old.example.com", "server.remoteOffline", "off", false],
      // Not asked (it would open a tunnel): no dot, never a made-up "online".
      ["far.example.com", "server.remote", undefined, false],
    ],
  );
  assert.equal(rows.current.id, "ssh:ops@box.example.com");
});

test("this computer in use keeps its name from the core, or the one the app remembered", () => {
  const known = [{ id: "local", kind: "local" as const, name: "Acme laptop", current: true }];
  const here = { local: true, online: true, host: "127.0.0.1" };
  assert.equal(serverRows(known, here, t).current.sub, "server.thisComputerNamed(Acme laptop)");
  assert.equal(
    serverRows(known, { ...here, machine: "Acme desktop" }, t).current.sub,
    "server.thisComputerNamed(Acme desktop)",
  );
  assert.deepEqual(serverRows(known, here, t).remote, []);
});
