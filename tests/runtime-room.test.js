// A runtime session, as a room you can read — and the three voices in it.
//
// Manu, 2026-09-20: "claude code, codex y opencode deberían verse en la lista
// de chats y tratarse como grupo quizás — el agente habla como agente pero
// claude recibe como yo mismo, y yo veo los 3 tipos: mi mensaje, el del agente
// y el de claude."
//
// From the engine's side there is ONE user: `claude -p` takes a prompt and does
// not care who typed it. From the room's side there are three speakers. This
// file is about the seam between those two facts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-room-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeToolHandlers } = await import("#core/agent/tools/registry.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
const {
  listProjectRuntimeRooms,
  readProjectRuntimeRoom,
  appendRuntimePrompt,
  RUNTIME_CHANNEL,
} = await import("#core/stores/runtime-room.js");

function setup() {
  const root = makeTempProject({
    name: "Test Project",
    agents: [{ slug: "roby", role: "Coordinator", model: "mock:test" }],
  });
  const projects = new ProjectManager({ engines: {} });
  const id = projects.register(root);
  return { root, projects, p: projects.get(typeof id === "number" ? id : projects.list().at(-1).id) };
}

function withFakeBinary(name, body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-runtime-room-bin-"));
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, body, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const oldPath = process.env.PATH || "";
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  return Promise.resolve(fn()).finally(() => {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

const handlers = (projects, extra = {}) => makeToolHandlers({
  projects,
  plugins: null,
  registries: null,
  globalConfig: { super_agent: { permission_mode: "total", name: "Roby" } },
  channel: "web",
  ...extra,
});

test("a launched session IS a room, and it exists before the runtime answers", async () => {
  const { root, projects, p } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho 'listo, arreglado'\n", async () => {
      await handlers(projects).call_runtime({
        runtime: "aider",
        prompt: "arreglá el punto azul\ny después contame",
        background: false,
      });
      const rooms = listProjectRuntimeRooms(p.storagePath);
      assert.equal(rooms.length, 1, "one session, one room");
      const room = rooms[0];
      assert.equal(room.channel, RUNTIME_CHANNEL);
      assert.equal(room.runtime, "aider");
      // The title is the first line of the prompt: what the session is ABOUT,
      // which is the only thing that tells two of them apart in a list.
      assert.equal(room.title, "arreglá el punto azul");
      assert.ok(room.cwd, "a room remembers which folder it opened");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("the engine's answer is signed by the ENGINE, not by the agent that launched it", async () => {
  const { root, projects, p } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho 'lo arreglé'\n", async () => {
      await handlers(projects).call_runtime({
        runtime: "aider",
        agent: "roby",
        prompt: "arreglalo",
        background: false,
      });
      const room = readProjectRuntimeRoom(p.storagePath, listProjectRuntimeRooms(p.storagePath)[0].id);
      // NOT `find(role === "assistant")`: the agent's own prompt renders that
      // way too, which is the design — both are on the left, in their own name.
      const engine = room.messages.find((m) => m.agent === "aider");
      assert.ok(engine, "the engine spoke");
      assert.match(engine.content || engine.text || "", /lo arreglé/);
      // This is the whole complaint: it used to read `actor_id: agent.slug`, so
      // Claude's own words arrived wearing Roby's name and Roby's avatar.
      assert.notEqual(engine.agent, "roby", "the agent did not say this");
      assert.equal(engine.agent, "aider");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("three voices: yours on the right, the agent's in its own name, the engine's in its own", async () => {
  const { root, projects, p } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho 'hecho'\n", async () => {
      await handlers(projects).call_runtime({
        runtime: "aider", agent: "roby", prompt: "empezá vos", background: false,
      });
      const id = listProjectRuntimeRooms(p.storagePath)[0].id;
      // …and then the owner writes into the same room, which is the half the
      // panel's composer will do.
      appendRuntimePrompt(p.logMessage, id, { body: "che, y el otro bug?", authored_by: "owner" });

      const room = readProjectRuntimeRoom(p.storagePath, id);
      const roles = room.messages.map((m) => `${m.role}:${m.agent || "-"}`);
      assert.deepEqual(roles, ["assistant:roby", "assistant:aider", "user:-"],
        "the agent's prompt, the engine's answer, and the owner's own line");

      const byAgent = room.messages[0];
      // The engine received it as the user. The room says who actually wrote it.
      assert.equal(byAgent.on_behalf_of, "owner", "Roby wrote it in Manu's name");
      assert.equal(room.messages[2].role, "user", "the owner's line is the owner's");
      assert.equal(room.messages[2].on_behalf_of, undefined, "nobody wrote it for them");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("the owner writing from the panel is the owner, not whoever launched it", async () => {
  const { root, projects, p } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho ok\n", async () => {
      // `promptAuthor` rides in the handler CONTEXT, never in the tool's args:
      // a model must not be able to sign the owner's name to its own message.
      await handlers(projects, { promptAuthor: "owner" }).call_runtime({
        runtime: "aider", agent: "roby", prompt: "seguí con esto", background: false,
      });
      const room = readProjectRuntimeRoom(p.storagePath, listProjectRuntimeRooms(p.storagePath)[0].id);
      assert.equal(room.messages[0].role, "user", "it was the owner who asked");
      assert.equal(room.launched_by, "owner");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("a session that throws leaves an answer in the room, not a question hanging", async () => {
  const { root, projects, p } = setup();
  try {
    // exit 0 with no output is the silent-success shape runtimeLooksLikeFailure
    // catches — the one that used to reach the owner as a confident "done".
    await withFakeBinary("aider", "#!/bin/sh\nexit 0\n", async () => {
      await handlers(projects).call_runtime({
        runtime: "aider", prompt: "algo que no se hace", background: false,
      });
      const rooms = listProjectRuntimeRooms(p.storagePath);
      assert.equal(rooms[0].phase, "failed", "the room says how it ended");
      const room = readProjectRuntimeRoom(p.storagePath, rooms[0].id);
      assert.ok(room.messages.some((m) => m.role === "assistant"), "the engine answered, even to say it failed");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("answering a session keeps you in the same room instead of opening a new one", async () => {
  const { root, projects, p } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho 'primera vuelta'\n", async () => {
      await handlers(projects).call_runtime({
        runtime: "aider", prompt: "arrancá", background: false,
      });
      const first = listProjectRuntimeRooms(p.storagePath);
      assert.equal(first.length, 1);

      // What the panel's composer does: continue THAT session, as the owner.
      // `call_runtime` mints a fresh session record on every run — if the room
      // followed the record, answering a session would start a second thread
      // and the chat list would grow a row per message.
      await handlers(projects, { promptAuthor: "owner" }).call_runtime({
        runtime: "aider",
        prompt: "dale, seguí",
        resume_session_id: first[0].id,
        background: false,
      });

      const rooms = listProjectRuntimeRooms(p.storagePath);
      assert.equal(rooms.length, 1, "still one conversation");
      assert.equal(rooms[0].id, first[0].id, "and it is the same one");
      const room = readProjectRuntimeRoom(p.storagePath, rooms[0].id);
      assert.equal(room.messages.length, 4, "two prompts and two answers");
      assert.equal(room.messages[2].role, "user", "the owner's follow-up is theirs");
    });
  } finally {
    cleanupTempProject(root);
  }
});
