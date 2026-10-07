import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { createStore } from "../domain/store.ts";
import type { IMessageOps } from "../imessage.ts";
import { builtinTools } from "../server-wiring.ts";
import { documentTool } from "../tools/documents.ts";
import { imessageTools } from "../tools/imessage.ts";
import { SPANISH_TITLES, toolTitle } from "./tool-titles.ts";

const setup = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-titles-"));
  const store = createStore(openDb(home), createBus());
  const tools = [...builtinTools(store, home, () => 0), ...imessageTools({} as IMessageOps), documentTool()];
  return { store, tools };
};

test("every built-in tool has a Spanish card title", () => {
  const { tools } = setup();
  const missing = tools.map((t) => t.name).filter((name) => !SPANISH_TITLES[name]);
  assert.deepEqual(missing, []);
});

test("titles follow the owner's language, Spanish by default", () => {
  const { store, tools } = setup();
  const post = tools.find((t) => t.name === "channel_post");
  assert.ok(post);
  assert.equal(toolTitle(store, post, { room: "#apx-help" }), "Publicó en #apx-help");
  store.settings.set("owner_language", "en");
  assert.equal(toolTitle(store, post, { room: "#apx-help" }), "Posted in #apx-help");
});
