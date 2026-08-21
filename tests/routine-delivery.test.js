// Routine output delivery — the run's answer actually reaching a channel.
//
// Before this existed, a routine wrote its answer to the ledger and stopped
// there: reaching a person meant a shell post_command or a paragraph asking the
// model to remember to call send_telegram, and the failure mode of both is
// silence. These tests cover the three things that make delivery trustworthy:
// it resolves the same way every time, it never sends the same message twice,
// and a delivery that reached nobody reports as an error instead of as "ok".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-routine-delivery-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;

// A post_command that names a real sink has to be DETECTED without being RUN:
// `apx telegram send` would reach for the daemon, and tests run offline. A stub
// first on PATH keeps the string the detector reads and takes the network out.
const STUB_BIN = path.join(TMP_HOME, "bin");
fs.mkdirSync(STUB_BIN, { recursive: true });
fs.writeFileSync(path.join(STUB_BIN, "apx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
process.env.PATH = `${STUB_BIN}:${process.env.PATH}`;

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  DELIVERY_ADAPTERS,
  deliveryChannelIds,
  normalizeDeliverTo,
  resolveDeliveryChannels,
  deliverySuppressedTools,
  deliverRoutineOutput,
  alreadyServedChannels,
} = await import("#core/routines/delivery.js");
const { runRoutineNow, routineReportsToTelegram } = await import("#core/routines/runner.js");
const { upsertRoutine, getRoutine } = await import("#core/stores/routines.js");
const { readGlobalMessages } = await import("#core/stores/messages.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

// ── resolution ──────────────────────────────────────────────────────────────

test("normalizeDeliverTo — null and [] are different values", () => {
  // The distinction the whole fallthrough rests on: nothing said vs. nowhere.
  assert.equal(normalizeDeliverTo(undefined), null);
  assert.equal(normalizeDeliverTo(null), null);
  assert.deepEqual(normalizeDeliverTo([]), []);
});

test("normalizeDeliverTo — accepts a comma string, trims, lowercases, dedupes", () => {
  assert.deepEqual(normalizeDeliverTo(" Telegram , web,telegram "), ["telegram", "web"]);
  assert.deepEqual(normalizeDeliverTo(["WEB", " web "]), ["web"]);
  assert.deepEqual(normalizeDeliverTo([null, 7, "web"]), ["web"]);
});

// ── the interruption gate on telegram delivery ────────────────────────────────
// send_telegram is suppressed for a delivering routine, so the budget that used
// to gate the push has to live in the telegram adapter. An all-day quiet window
// makes "held" deterministic without controlling the clock.
test("delivery gate — quiet-hours holds an ordinary push; scheduled/critical/solicited cross it; gate:null is unconditional", async () => {
  const routine = { name: "watch", id: "r1" };
  const quiet = { nudge: { enabled: true, quiet_hours: "00:00-23:59" } };
  const mk = () => {
    const sent = [];
    return {
      sent,
      ctx: {
        globalConfig: quiet,
        project: { id: "p1" },
        plugins: { get: (n) => (n === "telegram" ? { send: async (m) => sent.push(m) } : null) },
      },
    };
  };
  const deliver = (h, gate) =>
    deliverRoutineOutput(h.ctx, { routine, channels: ["telegram"], text: "hola", gate });

  const ordinary = mk();
  assert.equal((await deliver(ordinary, { severity: "normal", scheduled: false, unsolicited: true }))[0].status, "held");
  assert.equal(ordinary.sent.length, 0);

  const anchor = mk();
  assert.equal((await deliver(anchor, { severity: "normal", scheduled: true, unsolicited: true }))[0].status, "ok");
  assert.equal(anchor.sent.length, 1);

  const blocker = mk();
  assert.equal((await deliver(blocker, { severity: "critical", scheduled: false, unsolicited: true }))[0].status, "ok");

  const solicited = mk();
  assert.equal((await deliver(solicited, { severity: "normal", scheduled: false, unsolicited: false }))[0].status, "ok");

  const ungated = mk();
  assert.equal((await deliver(ungated, null))[0].status, "ok");
  assert.equal(ungated.sent.length, 1);
});

test("resolveDeliveryChannels — no opinion anywhere delivers nowhere", () => {
  // Every routine written before this feature must keep behaving as it did.
  const out = resolveDeliveryChannels({ name: "old" }, {});
  assert.deepEqual(out.channels, []);
  assert.equal(out.source, "none");
});

test("resolveDeliveryChannels — the routine's own list wins", () => {
  const out = resolveDeliveryChannels(
    { deliver_to: ["telegram", "web"] },
    { globalConfig: { routines: { deliver_to: ["web"] } } },
  );
  assert.deepEqual(out.channels, ["telegram", "web"]);
  assert.equal(out.source, "routine");
});

test("resolveDeliveryChannels — falls through to the deployment default", () => {
  const out = resolveDeliveryChannels({ name: "r" }, { globalConfig: { routines: { deliver_to: "web" } } });
  assert.deepEqual(out.channels, ["web"]);
  assert.equal(out.source, "config");
});

test("resolveDeliveryChannels — an explicit empty list stops the fallthrough", () => {
  const out = resolveDeliveryChannels(
    { deliver_to: [] },
    { globalConfig: { routines: { deliver_to: ["telegram"] } } },
  );
  assert.deepEqual(out.channels, []);
});

test("resolveDeliveryChannels — \"none\" says it out loud", () => {
  const out = resolveDeliveryChannels(
    { deliver_to: ["none"] },
    { globalConfig: { routines: { deliver_to: ["telegram"] } } },
  );
  assert.deepEqual(out.channels, []);
  assert.equal(out.source, "off");
});

test("resolveDeliveryChannels — \"profile\" reads routine_delivery", () => {
  const out = resolveDeliveryChannels(
    { deliver_to: ["profile"] },
    { profileConfig: { routine_delivery: ["telegram"], primary_channel: "web" } },
  );
  assert.deepEqual(out.channels, ["telegram"]);
  assert.equal(out.source, "profile");
});

test("resolveDeliveryChannels — \"profile\" falls back to primary_channel", () => {
  const out = resolveDeliveryChannels(
    { deliver_to: ["profile"] },
    { profileConfig: { primary_channel: "telegram" } },
  );
  assert.deepEqual(out.channels, ["telegram"]);
});

test("resolveDeliveryChannels — a profile that says nothing delivers nowhere", () => {
  const out = resolveDeliveryChannels({ deliver_to: ["profile"] }, { profileConfig: {} });
  assert.deepEqual(out.channels, []);
  assert.deepEqual(out.unknown, []);
});

test("resolveDeliveryChannels — an unroutable channel is reported, not swallowed", () => {
  // primary_channel's enum includes surfaces delivery has no adapter for.
  const out = resolveDeliveryChannels({ deliver_to: ["telegram", "carrier-pigeon"] }, {});
  assert.deepEqual(out.channels, ["telegram"]);
  assert.deepEqual(out.unknown, ["carrier-pigeon"]);
});

test("resolveDeliveryChannels — \"profile\" mixed with a literal channel merges both", () => {
  const out = resolveDeliveryChannels(
    { deliver_to: ["web", "profile"] },
    { profileConfig: { primary_channel: "telegram" } },
  );
  assert.deepEqual(out.channels, ["web", "telegram"]);
});

test("routineOutputText — reads whatever the handler called its output", async () => {
  const { routineOutputText } = await import("#core/routines/delivery.js");
  assert.equal(routineOutputText({ reply: " an agent answer " }), "an agent answer");
  assert.equal(routineOutputText({ text: "a telegram body" }), "a telegram body");
  assert.equal(routineOutputText({ stdout: "shell output" }), "shell output");
  assert.equal(routineOutputText({ status: "ok", note: "nothing to say" }), "");
  assert.equal(routineOutputText(null), "");
});

test("deliveryChannelIds — every id has an adapter", () => {
  assert.ok(Object.isFrozen(DELIVERY_ADAPTERS));
  const ids = deliveryChannelIds();
  assert.ok(ids.includes("telegram"));
  assert.ok(ids.includes("web"));
  for (const id of ids) assert.equal(typeof DELIVERY_ADAPTERS[id].deliver, "function");
});

// ── the double-send guard ───────────────────────────────────────────────────

test("deliverySuppressedTools — a telegram delivery takes send_telegram off the loop", () => {
  assert.deepEqual(deliverySuppressedTools(["telegram"]), ["send_telegram"]);
  assert.deepEqual(deliverySuppressedTools(["web"]), []);
  assert.deepEqual(deliverySuppressedTools([]), []);
  assert.deepEqual(deliverySuppressedTools(null), []);
});

test("routineReportsToTelegram — deliver_to telegram is a sink like a post_command", () => {
  assert.equal(routineReportsToTelegram({ autoSuppress: [], deliverTo: ["telegram"] }), true);
  assert.equal(routineReportsToTelegram({ autoSuppress: [], deliverTo: ["web"] }), false);
  assert.equal(routineReportsToTelegram({ autoSuppress: [] }), false);
});

test("alreadyServedChannels — a post_command sink already carries the message", () => {
  const served = alreadyServedChannels({
    routine: { kind: "super_agent" },
    channels: ["telegram", "web"],
    postSinks: ["send_telegram"],
    trace: [],
  });
  assert.deepEqual(served, [{ channel: "telegram", reason: "post_commands" }]);
});

test("alreadyServedChannels — a kind:telegram routine already sent it itself", () => {
  const served = alreadyServedChannels({
    routine: { kind: "telegram" },
    channels: ["telegram"],
    postSinks: [],
    trace: [],
  });
  assert.deepEqual(served, [{ channel: "telegram", reason: "handler" }]);
});

test("alreadyServedChannels — a tool call that got through is the backstop", () => {
  const served = alreadyServedChannels({
    routine: { kind: "super_agent" },
    channels: ["telegram"],
    postSinks: [],
    trace: [{ tool: "send_telegram", result: { ok: true } }],
  });
  assert.deepEqual(served, [{ channel: "telegram", reason: "agent" }]);
});

test("alreadyServedChannels — a tool call that FAILED does not count as sent", () => {
  const served = alreadyServedChannels({
    routine: { kind: "super_agent" },
    channels: ["telegram"],
    postSinks: [],
    trace: [{ tool: "send_telegram", result: { error: "chat not found" } }],
  });
  assert.deepEqual(served, []);
});

// ── the adapters ────────────────────────────────────────────────────────────

function fakeTelegram(sent) {
  return {
    get: (n) => (n === "telegram" ? { send: async (m) => { sent.push(m); return { ok: true }; } } : null),
  };
}

test("deliverRoutineOutput — telegram adapter sends and reports ok", async () => {
  const sent = [];
  const out = await deliverRoutineOutput(
    { plugins: fakeTelegram(sent), project: { id: 3 }, globalConfig: {} },
    { routine: { name: "standup", id: "r_1" }, channels: ["telegram"], text: "two things today" },
  );
  assert.deepEqual(out.map((d) => d.status), ["ok"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "two things today");
  assert.equal(sent[0].meta.routine, "standup");
});

test("deliverRoutineOutput — one channel failing does not lose the others", async () => {
  const out = await deliverRoutineOutput(
    { plugins: { get: () => null }, project: { id: 4 }, globalConfig: {} },
    { routine: { name: "standup", id: "r_2" }, channels: ["telegram", "web"], text: "still delivered" },
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].channel, "telegram");
  assert.equal(out[0].status, "error");
  assert.match(out[0].error, /telegram plugin not loaded/);
  assert.equal(out[1].channel, "web");
  assert.equal(out[1].status, "ok");
});

test("deliverRoutineOutput — the web adapter writes a readable, project-stamped row", async () => {
  await deliverRoutineOutput(
    { plugins: { get: () => null }, project: { id: 9 }, globalConfig: {} },
    { routine: { name: "digest", id: "r_3" }, channels: ["web"], text: "the digest body" },
  );
  const rows = readGlobalMessages({ channel: "web", limit: 50 });
  const mine = rows.filter((r) => r.meta?.routine === "digest");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].body, "the digest body");
  assert.equal(mine[0].type, "agent");
  // Unstamped rows land in the default workspace, which is not where it ran.
  assert.equal(String(mine[0].meta.project_id), "9");
});

// ── attachments (skill images the agent queued with attach_media) ────────────

function fakeTelegramWithPhoto(sent, shots) {
  return {
    get: (n) =>
      n === "telegram"
        ? {
            send: async (m) => { sent.push(m); return { ok: true }; },
            sendPhoto: async (m) => { shots.push(m); return { ok: true, message_id: 1 }; },
          }
        : null,
  };
}

test("deliverRoutineOutput — telegram sends the text then each queued photo", async () => {
  const sent = [];
  const shots = [];
  const out = await deliverRoutineOutput(
    { plugins: fakeTelegramWithPhoto(sent, shots), project: { id: 3 }, globalConfig: {} },
    {
      routine: { name: "golf-coach-am", id: "r_1" },
      channels: ["telegram"],
      text: "🏌️ Tip: el grip",
      attachments: [{ id: "grip", path: "/x/grip.jpg", mime: "image/jpeg", caption: "el agarre" }],
    },
  );
  assert.equal(out[0].status, "ok");
  assert.match(out[0].note, /\+1 photo/);
  assert.equal(sent.length, 1, "the text always goes first");
  assert.equal(shots.length, 1);
  assert.equal(shots[0].photo, "/x/grip.jpg");
  assert.equal(shots[0].caption, "el agarre");
});

test("deliverRoutineOutput — the web row carries the attached images in its meta", async () => {
  await deliverRoutineOutput(
    { plugins: { get: () => null }, project: { id: 11 }, globalConfig: {} },
    {
      routine: { name: "golf-web", id: "r_9" },
      channels: ["web"],
      text: "🏌️ Tip: el grip",
      attachments: [{ id: "grip", path: "/x/grip.jpg", file: "grip.jpg", mime: "image/jpeg", caption: "el agarre" }],
    },
  );
  const rows = readGlobalMessages({ channel: "web", limit: 50 });
  const mine = rows.filter((r) => r.meta?.routine === "golf-web");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].meta.local_path, "/x/grip.jpg", "first image on the flat field");
  assert.equal(mine[0].meta.media_kind, "photo");
  assert.equal(mine[0].meta.media.length, 1);
  assert.equal(mine[0].meta.media[0].caption, "el agarre");
});

// ── end to end through the runner ───────────────────────────────────────────

function makeCtx(root, { plugins, globalConfig } = {}) {
  const storagePath = path.join(TMP_HOME, ".apx", "projects", `p${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(storagePath, { recursive: true });
  const project = { id: 7, name: "northwind", path: root, storagePath, config: globalConfig, logMessage: () => {} };
  return {
    project,
    projects: { list: () => [project], get: () => project },
    plugins: plugins || { get: () => null },
    registries: null,
    globalConfig: globalConfig || {},
  };
}

test("runRoutineNow — a heartbeat's output reaches every configured channel", async () => {
  const root = makeTempProject({ name: "northwind" });
  const sent = [];
  const ctx = makeCtx(root, { plugins: fakeTelegram(sent) });
  try {
    const out = await runRoutineNow(ctx, {
      name: "pulse",
      kind: "heartbeat",
      schedule: "every:24h",
      deliver_to: ["telegram", "web"],
      spec: { message: "still alive" },
    });
    assert.equal(out.status, "ok");
    assert.deepEqual(out.delivery.channels, ["telegram", "web"]);
    assert.deepEqual(out.delivery.results.map((d) => d.status), ["ok", "ok"]);
    assert.equal(sent.length, 1);
  } finally {
    cleanupTempProject(root);
  }
});

test("runRoutineNow — a kind:telegram routine is not delivered twice", async () => {
  const root = makeTempProject({ name: "northwind" });
  const sent = [];
  const ctx = makeCtx(root, { plugins: fakeTelegram(sent) });
  try {
    const out = await runRoutineNow(ctx, {
      name: "ping",
      kind: "telegram",
      schedule: "every:24h",
      deliver_to: ["telegram"],
      spec: { text: "one message only" },
    });
    assert.equal(out.status, "ok");
    assert.equal(sent.length, 1, "the handler sent it; delivery must not send it again");
    assert.deepEqual(out.delivery.skipped, [{ channel: "telegram", reason: "handler" }]);
    assert.deepEqual(out.delivery.results, []);
  } finally {
    cleanupTempProject(root);
  }
});

test("runRoutineNow — a post_command sink keeps the delivery from duplicating it", async () => {
  const root = makeTempProject({ name: "northwind" });
  const sent = [];
  const ctx = makeCtx(root, { plugins: fakeTelegram(sent) });
  try {
    const out = await runRoutineNow(ctx, {
      name: "pulse",
      kind: "heartbeat",
      schedule: "every:24h",
      deliver_to: ["telegram"],
      post_commands: ['apx telegram send "$APX_LLM_OUTPUT"'],
      spec: { message: "hello" },
    });
    assert.deepEqual(out.delivery.skipped, [{ channel: "telegram", reason: "post_commands" }]);
    assert.equal(sent.length, 0);
  } finally {
    cleanupTempProject(root);
  }
});

test("runRoutineNow — delivered nowhere is an error, not a green run", async () => {
  // The bug this whole feature exists to end: the answer was produced, nobody
  // got it, and the run reported success.
  const root = makeTempProject({ name: "northwind" });
  const ctx = makeCtx(root, { plugins: { get: () => null } });
  try {
    const out = await runRoutineNow(ctx, {
      name: "pulse",
      kind: "heartbeat",
      schedule: "every:24h",
      deliver_to: ["telegram"],
      spec: { message: "nobody will read this" },
    });
    assert.equal(out.status, "error");
    assert.match(out.error, /nothing delivered/);
    assert.match(out.error, /telegram plugin not loaded/);
  } finally {
    cleanupTempProject(root);
  }
});

test("runRoutineNow — a routine with no deliver_to is untouched", async () => {
  const root = makeTempProject({ name: "northwind" });
  const sent = [];
  const ctx = makeCtx(root, { plugins: fakeTelegram(sent) });
  try {
    const out = await runRoutineNow(ctx, {
      name: "pulse",
      kind: "heartbeat",
      schedule: "every:24h",
      spec: { message: "quiet" },
    });
    assert.equal(out.status, "ok");
    assert.equal(out.delivery, undefined);
    assert.equal(sent.length, 0);
  } finally {
    cleanupTempProject(root);
  }
});

test("runRoutineNow — post_commands are told where it went", async () => {
  const root = makeTempProject({ name: "northwind" });
  const marker = path.join(TMP_HOME, "delivered.txt");
  const ctx = makeCtx(root);
  try {
    await runRoutineNow(ctx, {
      name: "pulse",
      kind: "heartbeat",
      schedule: "every:24h",
      deliver_to: ["web"],
      post_commands: [`printf '%s' "$APX_DELIVERED" > ${marker}`],
      spec: { message: "note it" },
    });
    assert.equal(fs.readFileSync(marker, "utf8"), "web");
  } finally {
    cleanupTempProject(root);
  }
});

// ── the store ───────────────────────────────────────────────────────────────

test("upsertRoutine — an absent deliver_to stays null, and an edit keeps the old one", () => {
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  const created = upsertRoutine(storage, { name: "r", kind: "heartbeat", schedule: "every:1h" });
  assert.equal(created.deliver_to, null, "absent must not become [] — that is the allowed_tools trap");

  const withDelivery = upsertRoutine(storage, {
    name: "r", kind: "heartbeat", schedule: "every:1h", deliver_to: ["web"],
  });
  assert.deepEqual(withDelivery.deliver_to, ["web"]);

  // An editor that does not know the field must not erase it.
  const edited = upsertRoutine(storage, { name: "r", kind: "heartbeat", schedule: "every:2h" });
  assert.deepEqual(edited.deliver_to, ["web"]);

  // Clearing it is possible, and says nowhere rather than nothing.
  const cleared = upsertRoutine(storage, {
    name: "r", kind: "heartbeat", schedule: "every:2h", deliver_to: [],
  });
  assert.deepEqual(cleared.deliver_to, []);
  assert.deepEqual(getRoutine(storage, "r").deliver_to, []);
});

// ── the loop and the sink, together ─────────────────────────────────────────

test("runRoutineNow — an agent routine delivering to telegram sends exactly once", async () => {
  // The two-messages bug (spec/done/01) with the other sink: the loop still has
  // send_telegram AND the runner is configured to deliver. One of them has to
  // stand down, and it is the loop.
  const root = makeTempProject({ name: "northwind", agents: [{ slug: "scout", model: "mock:test" }] });
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "scout.md"),
    "---\nname: scout\nmodel: mock:test\ndescription: Test project agent.\n---\n\n# scout\nDo the work.\n",
  );
  const sent = [];
  const cfg = { super_agent: { enabled: true, model: "mock:test", permission_mode: "total" } };
  const ctx = makeCtx(root, { plugins: fakeTelegram(sent), globalConfig: cfg });
  try {
    const out = await runRoutineNow(ctx, {
      name: "scout-morning",
      kind: "exec_agent",
      schedule: "every:24h",
      deliver_to: ["telegram"],
      spec: { agent: "scout", prompt: "Report [mock:tool:send_telegram]" },
    });
    assert.equal(out.status, "ok");
    assert.equal(sent.length, 1, "one message: the runner's, not the loop's");
    assert.deepEqual(out.delivery.results.map((d) => d.status), ["ok"]);
    // And the loop was told why it could not send, rather than silently firing.
    const call = (out.trace || []).find((t) => t.tool === "send_telegram");
    assert.ok(call, "the mock still attempted the call");
    assert.match(call.result.error, /suppressed for this invocation/);
  } finally {
    cleanupTempProject(root);
  }
});
