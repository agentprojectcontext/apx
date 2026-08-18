// The daemon serves the SPA, Telegram polling, voice and the deck from one
// process. Before this, a single async route that rejected took all of it down:
// Express 4 does not await handlers, so the rejection never reached an error
// handler (there was none), and Node >= 15 terminates on an unhandled rejection.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { asyncRoute, errorMiddleware } from "#host/daemon/api/shared.js";
import { buildApi } from "#host/daemon/api.js";

async function withServer(build, fn) {
  const app = express();
  app.use(express.json());
  build(app);
  app.use(errorMiddleware(() => {}));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("asyncRoute: a rejected handler becomes a 500 instead of hanging", async () => {
  await withServer(
    (app) =>
      app.get(
        "/boom",
        asyncRoute(async () => {
          throw new Error("engine probe failed");
        })
      ),
    async (base) => {
      const res = await fetch(`${base}/boom`);
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: "engine probe failed" });
    }
  );
});

test("asyncRoute: an async rejection after await is caught too", async () => {
  await withServer(
    (app) =>
      app.get(
        "/late",
        asyncRoute(async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error("late failure");
        })
      ),
    async (base) => {
      const res = await fetch(`${base}/late`);
      assert.equal(res.status, 500);
      assert.equal((await res.json()).error, "late failure");
    }
  );
});

test("asyncRoute: a successful handler is untouched", async () => {
  await withServer(
    (app) => app.get("/ok", asyncRoute(async (_req, res) => res.json({ ok: true }))),
    async (base) => {
      const res = await fetch(`${base}/ok`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    }
  );
});

test("errorMiddleware: honors an explicit status on the error", async () => {
  await withServer(
    (app) =>
      app.get(
        "/nope",
        asyncRoute(async () => {
          const e = new Error("not your project");
          e.status = 403;
          throw e;
        })
      ),
    async (base) => {
      const res = await fetch(`${base}/nope`);
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, "not your project");
    }
  );
});

test("errorMiddleware: does not double-send when the response already went out", async () => {
  await withServer(
    (app) =>
      app.get(
        "/partial",
        asyncRoute(async (_req, res) => {
          res.status(200).json({ ok: true });
          throw new Error("after send");
        })
      ),
    async (base) => {
      const res = await fetch(`${base}/partial`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    }
  );
});

test("a rejecting handler on a real daemon route returns 500 and leaves no unhandled rejection", async () => {
  // Poisoned project store: the first thing most project routes do is
  // `project(req, res)` → `projects.get(pid)`. Making that throw inside a real
  // registered route proves the whole chain — buildApi's middleware stack,
  // asyncRoute on the route module, errorMiddleware last — turns the rejection
  // into a JSON 500 instead of the pre-fix behavior (unhandled rejection,
  // daemon dead).
  const projects = {
    get() {
      throw new Error("store exploded");
    },
    list() {
      return [];
    },
  };
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });

  const rejections = [];
  const spy = (err) => rejections.push(err);
  process.on("unhandledRejection", spy);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/projects/1/agents/x/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "store exploded");
    // Let any stray rejection reach the event loop before asserting.
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", spy);
    await new Promise((r) => server.close(r));
  }
});

test("the daemon registers unhandledRejection, not just uncaughtException", async () => {
  const fs = await import("node:fs");
  const url = await import("node:url");
  const src = fs.readFileSync(
    url.fileURLToPath(new URL("../src/host/daemon/index.js", import.meta.url)),
    "utf8"
  );
  assert.match(src, /process\.on\("uncaughtException"/);
  assert.match(
    src,
    /process\.on\("unhandledRejection"/,
    "an unhandled rejection would otherwise terminate the daemon on Node >= 15"
  );
});

test("buildApi mounts a terminal error handler after the 404 catch-all", async () => {
  const fs = await import("node:fs");
  const url = await import("node:url");
  const src = fs.readFileSync(
    url.fileURLToPath(new URL("../src/host/daemon/api.js", import.meta.url)),
    "utf8"
  );
  const err404 = src.indexOf("no route ${req.method} ${req.path}");
  const errMw = src.indexOf("errorMiddleware(");
  assert.ok(err404 > 0 && errMw > 0, "both must be present");
  assert.ok(
    errMw > err404,
    "Express only recognises the error handler when it is mounted last"
  );
});
