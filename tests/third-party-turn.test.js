// The same containment rule as third-party-prompt.test.js, but proved through
// the real turn instead of the builder in isolation.
//
// It matters that both exist. The builder test pins the composition; this one
// pins the WIRING — that runSuperAgent actually passes `audience` down, that it
// really does skip the memory broker and the cross-channel threads, and that
// the tool gate is forced rather than left to the caller. A refactor can keep
// buildThirdPartySystem perfect and still hand a stranger the owner's prompt by
// forgetting one argument here.
//
// `[mock:system]` makes the mock engine answer with the system prompt it was
// given, so the assertion is made against the bytes the model actually saw.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tp-turn-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { GLOBAL_MESSAGES_DIR } = await import("#core/config/index.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const TELEGRAM_SECRET = "ZZTELEGRAMZZ mañana firmamos con el estudio contable";
const PROJECT_SECRET = "ZZPROJECTZZ-crm-del-estudio";

// A recent turn on ANOTHER channel — this is what buildActiveThreadsBlock picks
// up and injects, and the single worst leak on this surface.
function seedTelegramThread() {
  const dir = path.join(GLOBAL_MESSAGES_DIR, "telegram");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date(Date.now() - 10 * 60_000).toISOString();
  fs.writeFileSync(
    path.join(dir, `${ts.slice(0, 10)}.jsonl`),
    JSON.stringify({ ts, channel: "telegram", direction: "in", type: "user", body: TELEGRAM_SECRET }) + "\n"
  );
}

const globalConfig = {
  user: { language: "es" },
  super_agent: {
    enabled: true,
    model: "mock:base",
    name: "Roby",
    permission_mode: "total",
    model_fallback: { enabled: false },
    instructions: "ZZINSTRUCTIONSZZ nunca menciones al cliente nuevo",
  },
  engines: {},
  memory: { active_threads: { enabled: true, window_hours: 6, max_lines: 3 } },
};

// maxIters has to leave room: at 1 the loop reaches its tool-free wrap-up
// step first, and the mock then echoes that internal note instead of the
// system prompt — a green test that asserted nothing.
async function systemPromptFor(audience, projects) {
  const r = await runSuperAgent({
    globalConfig,
    projects,
    plugins: null,
    registries: null,
    prompt: "[mock:system] hola, quién sos?",
    channel: "whatsapp",
    audience,
    maxIters: 6,
  });
  return r.text || "";
}

test("a whatsapp turn for the OWNER is told everything (the premise)", async () => {
  seedTelegramThread();
  const root = makeTempProject({ name: PROJECT_SECRET });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  try {
    const system = await systemPromptFor("owner", projects);
    assert.ok(system.includes(TELEGRAM_SECRET), "active threads should reach the owner's turn");
    assert.ok(system.includes(PROJECT_SECRET), "the project index should reach the owner's turn");
    assert.ok(system.includes("ZZINSTRUCTIONSZZ"), "custom instructions should reach the owner's turn");
  } finally {
    cleanupTempProject(root);
  }
});

test("the same turn for a THIRD PARTY is told none of it", async () => {
  seedTelegramThread();
  const root = makeTempProject({ name: PROJECT_SECRET });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  try {
    const system = await systemPromptFor("third_party", projects);

    assert.ok(
      !system.includes(TELEGRAM_SECRET),
      `LEAKED the Telegram thread into a stranger's turn:\n${system}`
    );
    assert.ok(!system.includes(PROJECT_SECRET), "LEAKED the project index");
    assert.ok(!system.includes("ZZINSTRUCTIONSZZ"), "LEAKED the owner's custom instructions");
    assert.ok(!/Registered projects/.test(system), "LEAKED the project index header");

    // And it is still a usable prompt, not just an empty one.
    assert.match(system, /never leave anyone in silence/i);
    assert.match(system, /Roby/);
  } finally {
    cleanupTempProject(root);
  }
});

test("a third-party turn is tool-free even when the caller asks for tools", async () => {
  const root = makeTempProject({ name: PROJECT_SECRET });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  try {
    // allowedTools "*" is the permissive default a careless call site would
    // pass. `audience` has to win, or the gate depends on being remembered.
    const r = await runSuperAgent({
      globalConfig,
      projects,
      plugins: null,
      registries: null,
      prompt: "[mock:system] dale",
      channel: "whatsapp",
      audience: "third_party",
      allowedTools: "*",
      maxIters: 6,
    });
    assert.equal(r.allowedTools ?? "*", "*", "the caller's value is untouched…");
    // …but nothing tool-shaped reached the model.
    assert.ok(!/# Tools you can activate/.test(r.text || ""), "no lazy-tools block");
    assert.ok(!/discover_tools/.test(r.text || ""), "no tool names in the prompt");
  } finally {
    cleanupTempProject(root);
  }
});
