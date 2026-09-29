// A chat stays reachable from its project after the project ids move.
//
// The daemon numbers projects in registration order on every boot, so removing
// one (or a folder going missing) shifts every project after it down by one.
// Web turns stamped the NUMBER into the ledger, so after such a boot the inbox
// row pointed at a project id that no longer existed — the phone and the panel
// asked `GET /projects/<old>/super-agent/threads/web/<day>` and got
// `404 project not found`, drawn as an empty chat. Or the number now belonged
// to another project, and the thread was unreachable from its own.
//
// Two boots, over real HTTP: register acme + northwind, write a web turn inside
// northwind, then boot again without acme.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-ledger-project-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { makeTempProject } = await import("./_helpers.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const {
  appendGlobalMessage, ledgerProjectStamp, makeLedgerProjectResolver, setLedgerProjectResolver,
} = await import("#core/stores/messages.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acme = makeTempProject({ name: "acme" });
const northwind = makeTempProject({ name: "northwind" });

function boot(paths) {
  const pm = new ProjectManager({});
  pm.registerDefault();
  for (const p of paths) pm.register(p);
  setLedgerProjectResolver(makeLedgerProjectResolver(() => pm.ledgerIndex()));
  return pm;
}

async function withApi(pm, fn) {
  const app = buildApi({
    projects: pm, registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    await fn(async (p) => {
      const res = await fetch(base + p);
      return { status: res.status, body: await res.json() };
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const rowsOf = (body) => (Array.isArray(body) ? body : body?.data || []);

test("a web chat written in northwind still opens from northwind after acme is removed", async () => {
  // Boot 1: acme = 1, northwind = 2. The turn is stamped the way super-agent.js stamps it.
  const first = boot([acme, northwind]);
  const nw = first.list().find((p) => p.name === "northwind");
  assert.equal(String(nw.id), "2", "sanity: registration order");
  const stamp = ledgerProjectStamp(nw);
  appendGlobalMessage({ channel: "web", direction: "in", type: "user", author: "user", body: "Hola, esto es una prueba", meta: stamp });
  appendGlobalMessage({ channel: "web", direction: "out", type: "agent", author: "apx", body: "Recibido.", meta: stamp });

  // Boot 2: acme is gone, northwind is now 1.
  const second = boot([northwind]);
  assert.equal(String(second.list().find((p) => p.name === "northwind").id), "1");

  await withApi(second, async (get) => {
    const inbox = await get("/inbox");
    assert.equal(inbox.status, 200);
    const row = rowsOf(inbox.body).find((r) => r.kind === "super_agent" && r.channel === "web");
    assert.ok(row, "the web thread is listed");
    assert.equal(String(row.project_id), "1", "the row points at where northwind is NOW, not at the old 2");

    const thread = await get(`/projects/${row.project_id}/super-agent/threads/web/${row.conversation_id}`);
    assert.equal(thread.status, 200, `opening it must not 404: ${JSON.stringify(thread.body)}`);
    assert.equal(thread.body.messages.length, 2);
  });
});

test("the stamp carries the stable apx_id, the number and the name", () => {
  const s = ledgerProjectStamp({ id: 4, apx_id: "abc123def456", name: "northwind" });
  assert.deepEqual(s, { project_id: "4", project_apx_id: "abc123def456", project_name: "northwind" });
  assert.deepEqual(ledgerProjectStamp({ id: 5, apxId: "0123456789ab" }), { project_id: "5", project_apx_id: "0123456789ab" });
  assert.deepEqual(ledgerProjectStamp(null), {});
});

test("the resolver: apx_id first, then a number that still names the project, then the name, else Base", () => {
  const now = [
    { id: 0, apx_id: "default", name: "default" },
    { id: 1, apx_id: "nw0000000001", name: "northwind" },
    { id: 2, apx_id: "gl0000000002", name: "globex" },
  ];
  const r = makeLedgerProjectResolver(() => now);
  assert.equal(r({ project_id: "2", project_apx_id: "nw0000000001", project_name: "northwind" }), "1", "apx_id wins over a stale number");
  assert.equal(r({ project_id: "2", project_apx_id: null, project_name: "northwind" }), "1", "an old row with a name finds its project");
  assert.equal(r({ project_id: "2", project_apx_id: null, project_name: "globex" }), "2", "a number that still names the project stays");
  assert.equal(r({ project_id: "2", project_apx_id: null, project_name: null }), "2", "no name to arbitrate: the number is kept");
  assert.equal(r({ project_id: "9", project_apx_id: null, project_name: "gone" }), "0", "a project that exists nowhere opens in Base instead of 404");
});

test("the daemon registers the resolver at boot", () => {
  // The route tests above register it by hand; this is what makes the live
  // daemon do the same.
  const src = fs.readFileSync(path.join(ROOT, "src/host/daemon/index.js"), "utf8");
  assert.match(src, /setLedgerProjectResolver\(makeLedgerProjectResolver\(\(\) => projects\.ledgerIndex\(\)\)\)/);
});
