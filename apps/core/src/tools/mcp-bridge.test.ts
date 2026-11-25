import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { mcpBridge } from "./mcp-bridge.ts";
import { defineTool, type Tool } from "./types.ts";

const tool = (name: string, description = name): Tool =>
  defineTool({
    name,
    description,
    args: z.object({}),
    effect: "none",
    deadlineMs: 30_000,
    title: () => name,
    run: async () => "",
  });

test("tools outside an agent's focus are named in tool_search beside APX's rarely used ones, and listed as APX's", async () => {
  const own = [tool("show_widget"), tool("shell", "run a command")];
  const [search] = mcpBridge(
    [],
    async () => own,
    [],
    own.map((t) => t.name),
  );
  assert.match(search?.description ?? "", /Documents and widgets: show_widget; Your other tools: shell\./);
  const run = search?.run as unknown as (a: object) => Promise<string>;
  const listed = await run({ server: "apx" });
  assert.match(listed, /- show_widget: /);
  assert.match(listed, /- shell: run a command/);
});
