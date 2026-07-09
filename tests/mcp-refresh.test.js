import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test("POST /projects/:pid/mcps evicts only the written MCP from cached registries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-refresh-project-"));
  fs.mkdirSync(path.join(root, ".apc"), { recursive: true });

  const evicts = [];
  let rebuilds = 0;
  const projectEntry = { id: "p1", path: root, storagePath: null };
  const app = express();
  app.use(express.json());

  const { register } = await import("../src/host/daemon/api/mcps.js");
  register(app, {
    projects: { rebuild: () => { rebuilds += 1; } },
    project: () => projectEntry,
    registries: {
      evictName: (name) => { evicts.push(name); },
      for: () => ({
        getByName: (name) => ({ name, source: "apc", transport: "stdio", enabled: true }),
        list: () => [],
      }),
    },
  });

  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/projects/p1/mcps?scope=shared`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "example", command: "node", args: ["server.js"] }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(evicts, ["example"]);
    assert.equal(rebuilds, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("POST /projects/:pid/mcps allows partial updates for existing MCP config", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-partial-project-"));
  fs.mkdirSync(path.join(root, ".apc"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "mcps.json"),
    JSON.stringify({
      mcpServers: {
        example: { command: "node", args: ["server.js"], enabled: true },
      },
    }, null, 2)
  );

  const evicts = [];
  const projectEntry = { id: "p1", path: root, storagePath: null };
  const app = express();
  app.use(express.json());

  const { register } = await import("../src/host/daemon/api/mcps.js");
  register(app, {
    projects: { rebuild: () => {} },
    project: () => projectEntry,
    registries: {
      evictName: (name) => { evicts.push(name); },
      for: () => ({
        getByName: (name) => ({ name, source: "apc", transport: "stdio", enabled: false }),
        list: () => [],
      }),
    },
  });

  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/projects/p1/mcps?scope=shared`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "example", enabled: false }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(evicts, ["example"]);

    const saved = JSON.parse(fs.readFileSync(path.join(root, ".apc", "mcps.json"), "utf8"));
    assert.equal(saved.mcpServers.example.command, "node");
    assert.equal(saved.mcpServers.example.enabled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("POST /projects/:pid/vars clears cached registries after writing a variable", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-var-refresh-home-"));
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "apx-var-refresh-storage-"));
  const origHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const modUrl = new URL("../src/host/daemon/api/vars.js", import.meta.url).href +
      `?t=${Date.now()}-${Math.random()}`;
    const { register } = await import(modUrl);

    let shutdowns = 0;
    const app = express();
    app.use(express.json());
    register(app, {
      project: () => ({ id: "p1", storagePath: storage }),
      registries: { shutdown: () => { shutdowns += 1; } },
    });

    const { server, baseUrl } = await listen(app);
    try {
      const res = await fetch(`${baseUrl}/projects/p1/vars`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "TOKEN", value: "new-value", scope: "project" }),
      });
      assert.equal(res.status, 201);
      assert.equal(shutdowns, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    os.homedir = origHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(storage, { recursive: true, force: true });
  }
});
