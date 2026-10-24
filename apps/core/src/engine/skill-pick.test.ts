import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import { askedSkill, choose } from "../skills/picker.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** A fake Ollama: images point one way, golf another; anything else (the bland baseline) a third, each a bit apart. */
function vectorOf(text: string): number[] {
  if (/image|imagen|picture|dibujo/i.test(text)) return [1, 0, 0, 0.2];
  if (/golf/i.test(text)) return [0, 1, 0, 0.2];
  return [0.05 * (text.length % 5), 0.05 * (text.length % 3), 1, 0];
}

const ollama = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
    const { input } = JSON.parse(raw) as { input: string[] };
    res.end(JSON.stringify({ embeddings: input.map(vectorOf) }));
  });
});

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;

const skill = (name: string, description: string, body: string) =>
  env.client.call("skills.save", {
    name,
    target: "global",
    content: `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
  });
const skillsPart = (messages: Message[]) =>
  messages.flatMap((m) => m.parts).find((p): p is Extract<typeof p, { type: "skills" }> => p.type === "skills");

/** The last turn's input as the model read it (other calls, like a chat's title, are skipped). */
const turnInput = () =>
  String(
    llm.calls
      .map((c) => c.messages.at(-1)?.content)
      .filter((c) => String(c).startsWith("[context:"))
      .at(-1),
  );

before(async () => {
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  env = await startCore({ llm });
  await env.client.call("services.set", {
    id: "local",
    service: {
      kind: "embedding",
      dialect: "ollama-embed",
      label: "Ollama",
      base_url: `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`,
      enabled: true,
      needs_key: false,
      model: "embeddinggemma",
    },
  });
  await skill("image-gen", "Generate an image from a prompt.", "Call the images service with the prompt.");
  await skill("golf-tee", "Book a golf tee time.", "Open the club's booking page.");
});
after(async () => {
  await env.core.close();
  await new Promise<void>((r) => ollama.close(() => r()));
  await env.cleanup();
});

test("a message that matches a skill gets it named for the agent to load, and the chat shows what was weighed", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "creame una imagen de un gato" });
  const { messages } = await env.settle(t.id);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /\[skills for this message\]/);
  assert.match(input, /These resemble this message by meaning\.\nVery close to it, most likely what it needs:/);
  assert.doesNotMatch(input, /matched/, "a resemblance is never called a match");
  assert.match(input, /- image-gen: Generate an image from a prompt\./);
  assert.match(input, /call load_skill/);
  assert.doesNotMatch(input, /Loaded:|Call the images service/, "a match by meaning never puts the body in");
  assert.doesNotMatch(input, /golf-tee/, "the unrelated skill stays out");
  const part = skillsPart(messages);
  assert.deepEqual(part?.loaded, []);
  assert.deepEqual([...(part?.strong ?? []), ...(part?.hinted ?? [])], ["image-gen"]);
  assert.equal(part?.engine, "local/embeddinggemma");
  assert.equal(part?.scored[0]?.name, "image-gen");
});

test("a short message, or the picker turned off, adds nothing", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "imagen" });
  assert.equal(skillsPart((await env.settle(t.id)).messages), undefined);

  const s = await env.client.call("memory.settings", {});
  assert.equal(s.embedder, "Ollama · embeddinggemma");
  await env.client.call("memory.set_settings", { mode: s.mode, auto_compact: s.auto_compact, skill_picker: false });
  await env.client.call("threads.send", { thread: t.id, text: "creame una imagen de un gato" });
  const { messages } = await env.settle(t.id);
  assert.equal(skillsPart(messages), undefined);
  const last = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(last, /un gato/);
  assert.doesNotMatch(last, /\[skills for this message\]/);
});

test("a skill named with /name goes in whole, picker or not; an unknown name is just text", async () => {
  // The picker is off since the test above: "/" needs no engine.
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "/golf-tee mañana a las 9" });
  const { messages } = await env.settle(t.id);
  const input = turnInput();
  assert.match(input, /Loaded: golf-tee\nOpen the club's booking page/);
  assert.match(input, /\/golf-tee mañana a las 9/, "the owner's words stay as written");
  const part = skillsPart(messages);
  assert.deepEqual(part?.loaded, ["golf-tee"]);
  assert.equal(part?.engine, "");

  await env.client.call("threads.send", { thread: t.id, text: "/nada que ver" });
  await env.settle(t.id);
  assert.match(turnInput(), /\/nada que ver/);
  assert.doesNotMatch(turnInput(), /Loaded:/);
});

test("askedSkill reads only a leading /name that is a skill", () => {
  const list = [{ name: "golf-tee" }, { name: "PDF" }];
  assert.equal(askedSkill("/golf-tee", list)?.name, "golf-tee");
  assert.equal(askedSkill("  /pdf leé esto", list)?.name, "PDF");
  assert.equal(askedSkill("/golf-tee@ApxBot hola", list)?.name, "golf-tee");
  assert.equal(askedSkill("usá /golf-tee", list), undefined);
  assert.equal(askedSkill("/golf-teetime", list), undefined);
});

test("close matches are named, very close ones strongly; unrelated ones never count", () => {
  const s = (name: string, sim: number, rel: number) => ({ name, sim, rel });
  assert.deepEqual(choose([s("a", 0.65, 4), s("b", 0.5, 2.5), s("c", 0.2, 9)].sort((x, y) => y.rel - x.rel)), {
    strong: ["a"],
    hinted: ["b"],
  });
  // Far above its own floor but raw 0.38 or 0.49: not named at all; 0.55 is a suggestion.
  assert.deepEqual(choose([s("a", 0.38, 5), s("b", 0.49, 4)]), { strong: [], hinted: [] });
  assert.deepEqual(choose([s("a", 0.55, 3)]), { strong: [], hinted: ["a"] });
  assert.deepEqual(choose([s("a", 0.6, 1)]), { strong: [], hinted: [] });
});
