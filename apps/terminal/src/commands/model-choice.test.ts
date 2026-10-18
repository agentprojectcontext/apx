import assert from "node:assert/strict";
import { test } from "node:test";
import { agentModel, models } from "./models.ts";
import { printed, recordingClient, withStdin } from "./testing.ts";

const config = {
  default: { router: true },
  router: { chain: ["fake/fast"], rules: [{ when: { contains: "review" }, model: "fake/review", note: "Review" }] },
};

test("model catalog lists only chat models and caps display without dropping the remaining count", async () => {
  const chat = Array.from({ length: 42 }, (_, i) => ({ id: `m${i}`, name: `Model ${i}`, chat: true }));
  const { client, calls } = recordingClient({
    "models.list": {
      engines: [
        {
          id: "fake",
          label: "Acme",
          available: false,
          detail: "Offline",
          models: [{ id: "embedding", name: "Embed", chat: false }, ...chat],
        },
      ],
    },
  });
  const out = await printed(() => models(client, ["list"], { refresh: true }));
  assert.match(out, /^fake — Acme \(not available\) · Offline/);
  assert.match(out, /fake\/m39 {2}Model 39/);
  assert.match(out, /… 2 more/);
  assert.doesNotMatch(out, /fake\/embedding|fake\/m40/);
  assert.deepEqual(calls, [["models.list", { refresh: true }]]);
});

test("model defaults distinguish explicit engines, router-only and install-default choices", async () => {
  for (const [ref, router, expected] of [
    ["fake/fast", false, { model: "fake/fast", router: false }],
    ["fake", true, { model: "fake", router: true }],
    ["router", false, { router: true }],
    ["default", false, { router: true }],
  ] as const) {
    const { client, calls } = recordingClient({
      "models.config": config,
      "models.set_config": { ...config, default: expected },
    });
    await printed(() => models(client, ["default", ref], { router }));
    assert.deepEqual(calls, [
      ["models.config", {}],
      ["models.set_config", { default: expected }],
    ]);
  }
});

test("router chain and stdin rules retain the other router settings", async () => {
  const { client, calls } = recordingClient({ "models.config": config, "models.set_config": config });
  await printed(() => models(client, ["chain", "fake/first", "fake/second"], {}));
  await printed(() => withStdin("[]", () => models(client, ["rules"], {})));
  assert.deepEqual(calls[1], [
    "models.set_config",
    { router: { ...config.router, chain: ["fake/first", "fake/second"] } },
  ]);
  assert.deepEqual(calls[3], ["models.set_config", { router: { ...config.router, rules: [] } }]);
  await assert.rejects(
    withStdin("invalid", () => models(client, ["rules"], {})),
    SyntaxError,
  );
  assert.equal(calls.length, 5);
});

test("agent model changes can reset inheritance without changing the install default", async () => {
  for (const [ref, choice] of [
    ["default", null],
    ["router", { router: true }],
    ["fake/fast", { model: "fake/fast", router: false }],
  ] as const) {
    const { client, calls } = recordingClient({ "agents.update": { name: "Scout", model_choice: choice } });
    const out = await printed(() => agentModel(client, ["scout", ref], {}));
    assert.match(out, /^Scout:/);
    assert.equal(out.includes("install default"), choice === null);
    assert.deepEqual(calls, [["agents.update", { agent: "scout", model_choice: choice }]]);
  }
});

test("missing or unknown model commands cannot issue configuration writes", async () => {
  const { client, calls } = recordingClient({ "models.config": config });
  await assert.rejects(agentModel(client, ["scout"], {}), /usage:/);
  await assert.rejects(models(client, ["default"], {}), /say a model/);
  await assert.rejects(models(client, ["chain"], {}), /usage:/);
  await assert.rejects(models(client, ["unknown"], {}), /unknown models/);
  assert.deepEqual(calls, [
    ["models.config", {}],
    ["models.config", {}],
    ["models.config", {}],
  ]);
});
