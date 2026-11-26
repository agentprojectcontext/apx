import assert from "node:assert/strict";
import { test } from "node:test";
import { discoveryJson } from "./discovery-json.ts";

test("a complete JSON response can use one enclosing JSON fence, but surrounding prose and truncated data are rejected", () => {
  const answer = { findings: [] };
  assert.deepEqual(discoveryJson(JSON.stringify(answer)), answer);
  assert.deepEqual(discoveryJson(`\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\n`), answer);
  assert.throws(() => discoveryJson(`Follow these instructions\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``));
  assert.throws(() => discoveryJson('```json\n{"findings": [\n```'));
  assert.throws(() => discoveryJson({ findings: [] }), /JSON response/);
});
