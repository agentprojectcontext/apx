// What the super-agent sets up for the owner beyond apx_settings' own tests: another agent's grants for APX's tools,
// and memory's embedding engine and media services, each tried before it replaces what works (DECISIONS.md#d-267).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { settingsCore } from "./settings.test-support.ts";

let grants: Awaited<ReturnType<typeof settingsCore>>;
let settings: Awaited<ReturnType<typeof settingsCore>>;
before(async () => {
  grants = await settingsCore({ tool: "grant_tool" });
  settings = await settingsCore();
  await grants.env.client.call("agents.create", { slug: "acme-helper", name: "Acme Helper", prompt: "Help." });
  await grants.env.client.call("agents.create", {
    slug: "acme-browser",
    name: "Acme Browser",
    prompt: "Browse.",
  });
  await grants.env.client.call("agents.update", { agent: "acme-browser", tools: ["files"] });
});
after(async () => {
  for (const h of [grants, settings]) {
    await h.env.core.close();
    await h.env.cleanup();
  }
});

const granted = async (agent: string) =>
  (await grants.env.client.call("tools.approvals", {})).approvals
    .filter((g) => g.agent_id === agent && g.scope === "always")
    .map((g) => g.key);

test("grant_tool hands one of APX's own tools to another agent, and takes it back", async () => {
  const { answer } = await grants.ask({ agent: "acme-helper", tools: ["remember"] });
  assert.match(answer, /^Acme Helper can now use without asking: remember$/);
  assert.deepEqual(await granted("acme-helper"), ["apx:remember"]);
  const back = await grants.ask({ agent: "acme-helper", tools: ["remember"], revoke: true });
  assert.match(back.answer, /^Acme Helper asks the owner again before: remember$/);
  assert.deepEqual(await granted("acme-helper"), []);
});

test("grant_tool narrows a grant to a condition and an end date, and a plain grant again keeps that narrowing", async () => {
  const until = new Date(Date.now() + 86_400_000).toISOString();
  const { answer } = await grants.ask({
    agent: "acme-helper",
    tools: ["remember"],
    condition: "~/work/acme",
    expires_at: until,
  });
  assert.match(answer, /can now use without asking: remember \(only on ~\/work\/acme, until /);
  const row = async () =>
    (await grants.env.client.call("tools.approvals", {})).approvals.find(
      (g) => g.agent_id === "acme-helper" && g.key === "apx:remember",
    );
  assert.equal((await row())?.condition, "~/work/acme");
  assert.equal((await row())?.expires_at, until);
  await grants.ask({ agent: "acme-helper", tools: ["remember"] });
  assert.equal((await row())?.condition, "~/work/acme");
  const past = await grants.ask({ agent: "acme-helper", tools: ["remember"], expires_at: "2020-01-01T00:00:00.000Z" });
  assert.match(past.answer, /expires_at is already past/);
  await grants.ask({ agent: "acme-helper", tools: ["remember"], revoke: true });
  assert.equal(await row(), undefined);
});

test("grant_tool grants a tool the agent's list leaves out, its list being focus; a rule set to off and the team's tools stay walls", async () => {
  // The list only says what it uses first (DECISIONS.md#d-271): the grant is made, and the tool is found by tool_search.
  const listed = await grants.ask({ agent: "acme-browser", tools: ["remember"] });
  assert.match(listed.answer, /^Acme Browser can now use without asking: remember$/);
  assert.deepEqual(await granted("acme-browser"), ["apx:remember"]);
  const reach = async () => {
    await grants.ask("hello", undefined, "acme-browser");
    const tools = grants.llm.calls.at(-1)?.tools ?? [];
    const search = tools.find((t) => t.function.name === "tool_search")?.function.description ?? "";
    return { sent: tools.some((t) => t.function.name === "remember"), found: /\bremember\b/.test(search) };
  };
  assert.deepEqual(await reach(), { sent: false, found: true });
  // A rule the owner set to off keeps it out of the agent's turns, grant or not.
  await grants.env.client.call("agents.update", { agent: "acme-browser", rules: { write: "off" } });
  try {
    assert.deepEqual(await reach(), { sent: false, found: false });
  } finally {
    await grants.env.client.call("agents.update", { agent: "acme-browser", rules: null });
    await grants.ask({ agent: "acme-browser", tools: ["remember"], revoke: true });
  }
  const own = await grants.ask({ agent: "acme-helper", tools: ["apx_settings"] });
  assert.match(own.answer, /apx_settings stay yours/);
  assert.deepEqual(await granted("acme-browser"), []);
  assert.deepEqual(await granted("acme-helper"), []);
});

test("embeddings: the engine on this computer is described, and only a model from its list is set up", async () => {
  const { answer } = await settings.ask({ method: "embeddings.local" });
  assert.match(answer, /models: bge-m3 .*\nfits this computer: \S+\nembedding services, tried in order: /);
  const odd = await settings.ask({ method: "embeddings.install", params: { model: "acme-embed" } });
  assert.match(odd.answer, /pick one of bge-m3, embeddinggemma, nomic-embed-text/);
  assert.equal((await settings.env.client.call("runs.pending", {})).inputs.length, 0);
});

test("memory: searching by meaning needs an embedding engine on first, so it never switches to nothing", async () => {
  const semantic = { method: "memory.set_settings", params: { mode: "semantic" } };
  assert.match((await settings.ask(semantic)).answer, /no embedding engine is on .*embeddings\.local/);
  assert.equal((await settings.env.client.call("memory.settings", {})).mode, "notes");
});

const ollamaEmbed = (base_url: string) =>
  ({
    kind: "embedding",
    dialect: "ollama-embed",
    label: "Acme embeddings",
    base_url,
    enabled: true,
    needs_key: false,
    model: "nomic-embed-text",
  }) as const;
const service = async (id: string) =>
  (await settings.env.client.call("services.list", {})).services.find((s) => s.id === id);

test("services: a service that does not answer is not saved, and a key is never the agent's to type", async () => {
  const dead = { method: "services.set", params: { id: "acme-embed", service: ollamaEmbed("http://127.0.0.1:9") } };
  assert.match((await settings.ask(dead)).answer, /not saved: the service did not answer .*nothing changed/);
  assert.equal(await service("acme-embed"), undefined);
  const keyed = {
    method: "services.set",
    params: { id: "acme-embed", service: ollamaEmbed("http://127.0.0.1:9"), api_key: "x" },
  };
  assert.match((await settings.ask(keyed)).answer, /the owner types a service's key themselves/);
  const off = {
    method: "services.set",
    params: { id: "acme-embed", service: { ...ollamaEmbed("http://127.0.0.1:9"), enabled: false } },
  };
  assert.match((await settings.ask(off)).answer, /saved; services\.list shows it/);
  assert.equal((await service("acme-embed"))?.enabled, false);
});

test("services: sending a saved key to another address waits for the owner in every mode", async () => {
  await settings.env.client.call("services.set", {
    id: "acme-keyed",
    service: { ...ollamaEmbed("https://embed.example.com"), needs_key: true, enabled: false },
    api_key: "acme-test-key",
  });
  await settings.inMode("total", async () => {
    const move = {
      method: "services.set",
      params: { id: "acme-keyed", service: { base_url: "https://other.example.com" } },
    };
    const { detail } = await settings.ask(move, "deny");
    assert.match(
      detail,
      /^Change the service Acme embeddings\nservice\.base_url: "https:\/\/embed\.example\.com" → "https:\/\/other\.example\.com"$/,
    );
  });
  assert.equal((await service("acme-keyed"))?.base_url, "https://embed.example.com");
});
