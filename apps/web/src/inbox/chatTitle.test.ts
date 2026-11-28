import assert from "node:assert/strict";
import { test } from "node:test";
import type { T } from "../i18n/index.ts";
import { chatTitle } from "./chatTitle.ts";

const t = ((key: string) => key) as T;
const at = "2026-01-02T10:00:00.000Z";

test("a voice request is named as one, in its row and its header", () => {
  const quick = { kind: "call", title: "Pedido por voz", created_at: at, call: { mode: "quick" } } as const;
  assert.equal(chatTitle(quick, t, true), "call.quickName");
  assert.equal(chatTitle(quick, t), "call.quickTitled");
  const call = { kind: "call", title: "Call", created_at: at, call: { mode: "call" } } as const;
  assert.equal(chatTitle(call, t, true), "call.name");
  assert.equal(chatTitle({ kind: "call", title: "Call", created_at: at }, t), "call.titled");
  assert.equal(chatTitle({ kind: "home", title: "Home", created_at: at }, t), "Home");
});
