import assert from "node:assert/strict";
import { test } from "node:test";
import { type SlashContext, slashItems, slashQuery } from "./slash.ts";

const ctx: SlashContext = {
  busy: false,
  skills: [
    { name: "pdf", description: "Read and fill PDF forms." },
    { name: "image-gen", description: "Generate an image from a prompt." },
  ],
  models: [
    { ref: "codex/gpt-6-sol", label: "GPT-6 Sol" },
    { ref: "gemini/gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  ],
  currentModel: "gemini/gemini-3.6-flash",
  efforts: ["low", "medium", "high"],
  currentEffort: "high",
};

const names = (text: string, c: SlashContext = ctx) =>
  slashItems(text, c).map((i) =>
    i.kind === "command" ? i.id : i.kind === "skill" ? `skill:${i.name}` : i.kind === "model" ? i.ref : i.effort,
  );

test("only a field that starts with / and is one line opens the menu", () => {
  assert.equal(slashQuery("hola /model"), undefined);
  assert.equal(slashQuery("/model\nmás"), undefined);
  assert.deepEqual(slashQuery("/Mo"), { head: "mo", arg: undefined });
  assert.deepEqual(slashQuery("/model gpt"), { head: "model", arg: "gpt" });
});

test("a bare / lists the commands, then the skills; stop only while the agent works", () => {
  assert.deepEqual(names("/"), [
    "new",
    "compact",
    "model",
    "effort",
    "usage",
    "skills",
    "skill:image-gen",
    "skill:pdf",
  ]);
  assert.ok(names("/", { ...ctx, busy: true }).includes("stop"));
  assert.ok(!names("/", { ...ctx, efforts: [] }).includes("effort"), "no effort row for a model without efforts");
});

test("typing narrows by prefix first, aliases and descriptions too", () => {
  assert.deepEqual(names("/co"), ["compact", "usage"]);
  assert.deepEqual(names("/clear"), ["new"]);
  assert.deepEqual(names("/ima"), ["skill:image-gen"]);
  assert.deepEqual(names("/forms"), ["skill:pdf"]);
});

test("/model and /effort list what can be picked; a skill with words is sent as written", () => {
  assert.deepEqual(names("/model "), ["codex/gpt-6-sol", "gemini/gemini-3.6-flash"]);
  assert.deepEqual(names("/model gem"), ["gemini/gemini-3.6-flash"]);
  const model = slashItems("/model gem", ctx)[0];
  assert.ok(model?.kind === "model" && model.current);
  assert.deepEqual(names("/effort h"), ["high"]);
  assert.deepEqual(names("/pdf leé esto"), []);
});
