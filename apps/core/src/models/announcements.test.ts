import assert from "node:assert/strict";
import { test } from "node:test";
import { type CatalogEngine, ModelAnnouncement } from "@apx/protocol";
import { modelAnnouncements } from "./announcements.ts";

const engine = (patch: Partial<CatalogEngine> = {}): CatalogEngine => ({
  id: "gemini",
  kind: "provider",
  label: "Gemini",
  available: true,
  models: [{ id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", chat: true }],
  ...patch,
});

test("a verified launch is relevant only to a usable, fresh exact chat model list", () => {
  const [launch] = modelAnnouncements([engine()]);
  assert.ok(launch);
  assert.equal(launch.model, "gemini-4-hydrogen");
  assert.equal(launch.date, "2026-11-12");
  assert.equal(launch.integration, "pending");
  assert.deepEqual(launch.engines, ["gemini"]);
  assert.ok(ModelAnnouncement.safeParse(launch).success);
  for (const unavailable of [
    engine({ available: false }),
    engine({ kind: "harness", id: "gemini-cli" }),
    engine({ detail: "Last list; refresh failed" }),
    engine({ models: [] }),
    engine({ models: [{ id: "gemini-4-hydrogen", name: "Hydrogen", chat: false }] }),
    engine({ models: [{ id: "gemini-4-hydrogen-image", name: "Image", chat: true }] }),
  ])
    assert.deepEqual(modelAnnouncements([unavailable]), []);
});

test("the same launch through several engines is one notice with a stable identity", () => {
  const [first] = modelAnnouncements([engine()]);
  const launches = modelAnnouncements([engine(), engine({ id: "gateway" })]);
  assert.equal(launches.length, 1);
  assert.equal(launches[0]?.id, first?.id);
  assert.deepEqual(launches[0]?.engines, ["gemini", "gateway"]);
  assert.equal(launches[0]?.integration, "pending", "listing never establishes compatibility or inference access");
});

test("restricted and unrelated launches are not promoted from a catalog alone", () => {
  assert.deepEqual(
    modelAnnouncements([
      engine({
        id: "anthropic",
        models: [
          { id: "claude-mythos-5-2", name: "Mythos", chat: true },
          { id: "gpt-6-cyber", name: "Cyber", chat: true },
          { id: "gpt-image-2.6", name: "Image", chat: false },
        ],
      }),
    ]),
    [],
  );
  const [fable] = modelAnnouncements([
    engine({
      id: "anthropic",
      models: [{ id: "claude-fable-5-2", name: "Fable", chat: true }],
    }),
  ]);
  assert.equal(fable?.integration, "pending");
  assert.match(fable?.access.en ?? "", /30-day/);
  assert.match(fable?.source ?? "", /^https:\/\/platform.claude.com\//);
});
