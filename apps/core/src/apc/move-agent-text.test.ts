import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutAgentParent } from "./move-agent-text.ts";

test("moving a definition detaches its parent while preserving instructions byte for byte", () => {
  for (const newline of ["\n", "\r\n"]) {
    const body = `${newline}${newline}  Keep the exact instructions.  ${newline}${newline}parent: this is prompt text${newline}`;
    const before = ["---", "name: Researcher", "parent: lead", "tools: files, shell", "---"].join(newline) + body;
    const after = ["---", "name: Researcher", "tools: files, shell", "---"].join(newline) + body;
    assert.equal(withoutAgentParent(before), after);
    assert.equal(withoutAgentParent(after), after);
    assert.equal(withoutAgentParent(`\uFEFF${before}`), `\uFEFF${after}`);
  }
  assert.equal(
    withoutAgentParent("---\nname: Researcher\nParent: |\n  lead\nrole: Research\n---\nBody"),
    "---\nname: Researcher\nrole: Research\n---\nBody",
  );
  assert.throws(() => withoutAgentParent("No frontmatter"), /frontmatter/);
});
