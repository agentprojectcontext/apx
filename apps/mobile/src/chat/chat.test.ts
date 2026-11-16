import assert from "node:assert/strict";
import { test } from "node:test";
import { translator } from "../i18n/index.ts";
import type { Message } from "../protocol";
import {
  type CatalogEngine,
  choiceLabel,
  choiceText,
  chosenEffort,
  effortLabel,
  effortOptions,
  modelOptions,
  splitRef,
  withEffort,
} from "./models.ts";
import { compact, showsStartHint, usageText, withDays } from "./transcript.ts";

const message = (id: string, created_at: string): Message =>
  ({ id, thread_id: "t", seq: 1, author: { kind: "user" }, parts: [], created_at }) as Message;

test("each day starts with its own row, once", () => {
  const rows = withDays([
    message("a", new Date(2026, 9, 6, 22).toISOString()),
    message("b", new Date(2026, 9, 7, 8).toISOString()),
    message("c", new Date(2026, 9, 7, 9).toISOString()),
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "day" ? "day" : row.message.id)),
    ["day", "a", "day", "b", "c"],
  );
});

test("token counts read short, and the chat's fill shows over its window", () => {
  assert.equal(compact(950), "950");
  assert.equal(compact(1234), "1.2k");
  assert.equal(compact(26_000), "26k");
  assert.equal(compact(1_200_000), "1.2M");
  assert.equal(usageText({ context: 26_000, window: 200_000 }), "26k / 200k");
  assert.equal(usageText({}), undefined);
});

const catalog = [
  {
    id: "gemini",
    kind: "provider" as const,
    label: "Gemini",
    available: true,
    models: [
      { id: "flash", name: "Flash", chat: true },
      { id: "embed", name: "Embed", chat: false },
    ],
  },
  {
    id: "groq",
    kind: "provider" as const,
    label: "Groq",
    available: false,
    models: [{ id: "x", name: "X", chat: true }],
  },
  {
    id: "claude",
    kind: "harness" as const,
    label: "Claude Code",
    available: true,
    models: [{ id: "opus", name: "Opus", chat: true }],
  },
];

test("a chat offers the model APIs that answer now; a CLI session only that CLI's models", () => {
  assert.deepEqual(
    modelOptions(catalog, undefined).map((g) => [g.engine, g.models.map((m) => m.ref)]),
    [["Gemini", ["gemini/flash"]]],
  );
  assert.deepEqual(
    modelOptions(catalog, "claude").flatMap((g) => g.models.map((m) => m.ref)),
    ["claude/opus"],
  );
  assert.deepEqual(modelOptions(catalog, undefined, "nothing"), []);
});

test("a model choice reads as its ref without the effort, or as the router", () => {
  assert.deepEqual(splitRef("chatgpt/gpt-6#high"), { engine: "chatgpt", model: "gpt-6", effort: "high" });
  assert.equal(choiceText({ model: "chatgpt/gpt-6#high", router: false }, catalog, "Auto"), "chatgpt/gpt-6");
  assert.equal(choiceText({ model: "gemini", router: false }, catalog, "Auto"), "Gemini");
  assert.equal(choiceText({ router: true }, catalog, "Auto"), "Auto");
});

test("an empty chat says where to start once loaded, not while loading or while the agent works", () => {
  const empty = { rows: 0, working: false, fresh: false, loaded: true };
  assert.equal(showsStartHint(empty), true);
  assert.equal(showsStartHint({ ...empty, loaded: false }), false);
  assert.equal(showsStartHint({ ...empty, loaded: false, fresh: true }), true);
  assert.equal(showsStartHint({ ...empty, working: true }), false);
  assert.equal(showsStartHint({ ...empty, rows: 2 }), false);
});

test("a choice with fallbacks counts them on its chip, in the singular for one", () => {
  const en = translator("en");
  const es = translator("es");
  assert.equal(choiceLabel({ model: "chatgpt/gpt-6", router: false }, [], en, "Auto"), "chatgpt/gpt-6");
  assert.equal(
    choiceLabel({ model: "chatgpt/gpt-6", router: false, fallbacks: ["gemini/flash"] }, [], en, "Auto"),
    "chatgpt/gpt-6 · 1 fallback",
  );
  assert.equal(
    choiceLabel({ model: "chatgpt/gpt-6", router: true, fallbacks: ["a/b", "c/d"] }, [], es, "Auto"),
    "chatgpt/gpt-6 · 2 respaldos + Automático",
  );
  assert.equal(choiceLabel({ router: true, fallbacks: ["a/b"] }, [], en, "Auto"), "Auto");
});

const gpt = { ref: "chatgpt/gpt-6", efforts: ["low", "medium", "high"], defaultEffort: "medium" };

test("a model's efforts read as the panel's, with its default only when the catalog names none", () => {
  const en = translator("en");
  const es = translator("es");
  assert.deepEqual(
    effortOptions(gpt, es).map((o) => o.label),
    ["Bajo", "Medio", "Alto"],
  );
  assert.deepEqual(effortOptions({ efforts: ["high", "xhigh"] }, en), [
    { value: "", label: "Its default" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
  ]);
  assert.deepEqual(effortOptions({ efforts: [] }, en), []);
  assert.equal(effortLabel("turbo", en), "Turbo");
});

test("picking an effort sends model#effort, and the model's default as no effort", () => {
  assert.equal(withEffort("chatgpt/gpt-6", "high", "medium"), "chatgpt/gpt-6#high");
  assert.equal(withEffort("chatgpt/gpt-6#high", "medium", "medium"), "chatgpt/gpt-6");
  assert.equal(withEffort("chatgpt/gpt-6", "", undefined), "chatgpt/gpt-6");
});

test("the chosen effort is the choice's own, else the model's default, only for that model", () => {
  assert.equal(chosenEffort({ model: "chatgpt/gpt-6#high", router: false }, gpt), "high");
  assert.equal(chosenEffort({ model: "chatgpt/gpt-6", router: false }, gpt), "medium");
  assert.equal(chosenEffort({ model: "chatgpt/gpt-6", router: false }, { ref: gpt.ref }), "");
  assert.equal(chosenEffort({ model: "gemini/flash#high", router: false }, gpt), undefined);
  assert.equal(chosenEffort(undefined, gpt), undefined);
});

test("the chip shows the effort a choice asks for", () => {
  assert.equal(
    choiceLabel({ model: "chatgpt/gpt-6#high", router: false }, [], translator("es"), "Auto"),
    "chatgpt/gpt-6 · Alto",
  );
  assert.equal(
    choiceLabel({ model: "chatgpt/gpt-6#xhigh", router: false, fallbacks: ["a/b"] }, [], translator("en"), "Auto"),
    "chatgpt/gpt-6 · Extra high · 1 fallback",
  );
});

test("each model option carries the efforts the catalog lists", () => {
  const catalog: CatalogEngine[] = [
    {
      id: "chatgpt",
      kind: "provider",
      label: "ChatGPT",
      available: true,
      models: [
        { id: "gpt-6", name: "GPT-6", chat: true, efforts: ["low", "high"], default_effort: "high" },
        { id: "mini", name: "Mini", chat: true },
      ],
    },
  ];
  const [group] = modelOptions(catalog, undefined);
  assert.deepEqual(
    group?.models.map((m) => [m.ref, m.efforts, m.defaultEffort]),
    [
      ["chatgpt/gpt-6", ["low", "high"], "high"],
      ["chatgpt/mini", [], undefined],
    ],
  );
});
