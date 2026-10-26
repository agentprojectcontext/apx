import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngineUsage, detectUsageEngines } from "../harness/engine-usage.ts";

test("selected configured engines report unsupported limits without starting a model or duplicating OpenCode", async () => {
  const lookedUp: string[] = [];
  const engines = await detectUsageEngines(
    async (command) => {
      lookedUp.push(command);
      return command;
    },
    [
      { id: "acp:opencode", label: "OpenCode", command: "opencode" },
      { id: "acp:custom", label: "Custom engine", command: "custom-cli" },
      { id: "aider", label: "Aider", command: "aider" },
    ],
  );
  assert.equal(lookedUp.filter((command) => command === "opencode").length, 1);
  const report = createEngineUsage({
    status: async () => engines,
    enabled: (id) => id === "aider" || id === "acp:custom",
    read: async () => {
      throw new Error("disabled Codex must not be probed");
    },
  });
  assert.deepEqual(
    (await report()).engines.map((engine) => [engine.label, engine.reason]),
    [
      ["Custom engine", "unsupported"],
      ["Aider", "unsupported"],
    ],
  );
});
