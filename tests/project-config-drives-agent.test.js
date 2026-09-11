// A project agent runs on ITS project's config.
//
// Half of this was already true: the turn itself was handed `p.config` (global
// merged with the project's own). But the MODEL was resolved against the bare
// global config, so a project that pinned `super_agent.model` — the one setting
// the whole layer exists to carry — was ignored for exactly that decision, and
// then ran the turn with the project config for everything else. One turn, two
// configs, and the one you could see in the project screen was not the one that
// chose the model.
//
// The proof uses a provider that does not exist: the router names it in the
// error, so the assertion cannot pass by accident and no network call happens.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-pcfg-run-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { writeProjectConfig, projectConfigPath } = await import("#host/daemon/project-config.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const GLOBAL = {
  host: "127.0.0.1",
  port: 7430,
  super_agent: {
    name: "apx",
    model: "mock:global-model",
    model_fallback: { enabled: false, models: [] },
    routing: { enabled: false, rules: [] },
  },
};

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(root) {
  const projects = new ProjectManager(GLOBAL);
  projects.register(root);
  const app = buildApi({
    projects, registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: GLOBAL,
    token: "",
  });
  return { app, projects };
}

const json = { "content-type": "application/json" };

test("the model comes from the project's own config file, not the global one", async () => {
  const root = makeTempProject({});
  const { app, projects } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const list = await (await fetch(`${baseUrl}/api/projects`)).json();
    const pid = list.find((x) => x.path === root).id;

    await fetch(`${baseUrl}/api/projects/${pid}/agents`, {
      method: "POST", headers: json,
      // No `model:` on the card — the card wins when it has one, and this test
      // is about what happens when the answer has to come from config.
      body: JSON.stringify({ slug: "nati", name: "Nati", system: "You are Nati." }),
    });

    writeProjectConfig(root, {
      super_agent: {
        model: "apx-proof:pinned-by-the-project",
        model_fallback: { enabled: false, models: [] },
        routing: { enabled: false, rules: [] },
      },
    });
    // The file is outside the checkout, which is the other half of the promise.
    assert.ok(!projectConfigPath(root).startsWith(root));
    projects.rebuild(pid);

    const r = await fetch(`${baseUrl}/api/projects/${pid}/agents/nati/exec`, {
      method: "POST", headers: json, body: JSON.stringify({ prompt: "hola" }),
    });
    const body = await r.json();
    const said = JSON.stringify(body);
    assert.match(said, /apx-proof/, `the project's pinned provider decided the call — got ${said}`);
    assert.doesNotMatch(said, /global-model/, "the global model must not win over the project's");
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("with no project config, the global model is still what runs", async () => {
  const root = makeTempProject({ name: "plain" });
  const { app } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const list = await (await fetch(`${baseUrl}/api/projects`)).json();
    const pid = list.find((x) => x.path === root).id;
    await fetch(`${baseUrl}/api/projects/${pid}/agents`, {
      method: "POST", headers: json,
      body: JSON.stringify({ slug: "nati", name: "Nati", system: "You are Nati." }),
    });

    const r = await fetch(`${baseUrl}/api/projects/${pid}/agents/nati/exec`, {
      method: "POST", headers: json, body: JSON.stringify({ prompt: "hola" }),
    });
    // The mock engine answers, so this is a 200 — what matters is that nothing
    // about the relocation broke the ordinary "inherit the global" case.
    assert.notEqual(r.status, 400, await r.clone().text());
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});
