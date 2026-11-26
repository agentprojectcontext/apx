import assert from "node:assert/strict";
import { test } from "node:test";
import { shortInterests } from "./research-terms.ts";

test("an interest said as a sentence becomes short search terms", () => {
  assert.deepEqual(shortInterests(["Agentes de IA para programar, en particular novedades de Claude Code y Codex"]), [
    "Agentes de IA para programar",
    "Claude Code",
    "Codex",
  ]);
  assert.deepEqual(shortInterests(["Me interesa mucho todo lo que tenga que ver con la fotografía analógica."]), [
    "la fotografía analógica",
  ]);
  assert.deepEqual(shortInterests(["News about Claude Code and Codex"]), ["Claude Code", "Codex"]);
  assert.deepEqual(
    shortInterests(["Ciencia y tecnología", "ciencia y tecnología"]),
    ["Ciencia y tecnología"],
    "a short name stays whole, once",
  );
  assert.ok(shortInterests(["uno dos tres cuatro cinco seis siete ocho"]).every((t) => t.split(" ").length <= 5));
});
