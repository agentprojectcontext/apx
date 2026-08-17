import { test } from "node:test";
import assert from "node:assert/strict";
import { apiRouter } from "./_helpers.js";
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

test("POST /admin/reload clears cached MCP registries", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-admin-reload-"));
  const origHomedir = os.homedir;
  const prevApxHome = process.env.APX_HOME;
  // Stubbing homedir() alone is not isolation: any ~/.apx path that comes from
  // a constant frozen at import time in config/paths.js ignores the stub and
  // resolves to the real home. APX_HOME is read on every call, so it holds.
  os.homedir = () => tmpHome;
  process.env.APX_HOME = path.join(tmpHome, ".apx");

  try {
    const apxHome = path.join(tmpHome, ".apx");
    fs.mkdirSync(apxHome, { recursive: true });
    fs.writeFileSync(
      path.join(apxHome, "config.json"),
      JSON.stringify({ super_agent: { model: "test:model" } }, null, 2)
    );

    const modUrl = new URL("../src/host/daemon/api/admin.js", import.meta.url).href +
      `?t=${Date.now()}-${Math.random()}`;
    const { register } = await import(modUrl);

    let shutdowns = 0;
    const config = {};
    const app = express();
    app.use(express.json());
    register(apiRouter(express, app), {
      scheduler: {},
      plugins: {},
      config,
      registries: { shutdown: () => { shutdowns += 1; } },
    });

    const { server, baseUrl } = await listen(app);
    try {
      const res = await fetch(`${baseUrl}/api/admin/reload`, { method: "POST" });
      assert.equal(res.status, 200);
      assert.equal(shutdowns, 1);
      assert.equal(config.super_agent.model, "test:model");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    os.homedir = origHomedir;
    if (prevApxHome === undefined) delete process.env.APX_HOME;
    else process.env.APX_HOME = prevApxHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
