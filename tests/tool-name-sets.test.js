// The behavioural tool sets drive real user-facing protections, and every one
// of them used to be a string literal written far from the tool it named:
//
//   - SIDE_EFFECT_TOOLS was an inline `new Set([...])` inside runAgent(). It is
//     what stops a weak model re-sending the same Telegram message three times.
//     Rename a tool and the protection silently stops applying.
//   - RISK_EXEMPT_TOOLS listed "finish" as a literal — and `finish` was not in
//     the TOOLS catalog at all, so nothing could have caught a rename.
//
// These tests make that class of drift impossible: a member that stops being a
// real tool name fails here instead of failing silently in production.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TOOLS,
  SIDE_EFFECT_TOOLS,
  ACK_ONLY_TOOLS,
  TURN_ENDING_TOOLS,
  RISK_EXEMPT_TOOLS,
  NATIVE_TOOL_NAMES,
  CODE_PLAN_TOOLS,
  CODE_CHANNEL_TOOLS,
} from "#core/agent/tools/names.js";

const SETS = {
  SIDE_EFFECT_TOOLS,
  ACK_ONLY_TOOLS,
  TURN_ENDING_TOOLS,
  RISK_EXEMPT_TOOLS,
  NATIVE_TOOL_NAMES,
  CODE_PLAN_TOOLS,
  CODE_CHANNEL_TOOLS,
};

const KNOWN = new Set(Object.values(TOOLS));

for (const [name, set] of Object.entries(SETS)) {
  test(`${name}: every member is a real tool name`, () => {
    const members = [...set];
    assert.ok(members.length > 0, `${name} must not be empty`);
    const undef = members.filter((m) => m === undefined);
    assert.deepEqual(
      undef,
      [],
      `${name} references a TOOLS key that does not exist (undefined member)`
    );
    const unknown = members.filter((m) => !KNOWN.has(m));
    assert.deepEqual(
      unknown,
      [],
      `${name} names tools missing from the TOOLS catalog: ${unknown.join(", ")}`
    );
  });
}

test("TOOLS: values are unique and snake_case", () => {
  const values = Object.values(TOOLS);
  assert.equal(new Set(values).size, values.length, "duplicate tool name");
  const bad = values.filter((v) => !/^[a-z][a-z0-9_]*$/.test(v));
  assert.deepEqual(bad, [], `not snake_case: ${bad.join(", ")}`);
});

test("TOOLS: keys and values stay aligned (SCREAMING_SNAKE <-> snake_case)", () => {
  const mismatched = Object.entries(TOOLS).filter(
    ([key, value]) => key.toLowerCase() !== value
  );
  assert.deepEqual(
    mismatched.map(([k, v]) => `${k} -> ${v}`),
    [],
    "a typo on either half is only visible when the two are compared"
  );
});

// `finish` is synthesised by run-agent.js rather than living in handlers/, so
// it is the easiest one to forget. It is also the tool the completion contract
// depends on.
test("TOOLS.FINISH exists and matches what run-agent emits", async () => {
  assert.equal(TOOLS.FINISH, "finish");
  const fs = await import("node:fs");
  const url = await import("node:url");
  const src = fs.readFileSync(
    url.fileURLToPath(new URL("../src/core/agent/run-agent.js", import.meta.url)),
    "utf8"
  );
  assert.ok(
    !/["']finish["']/.test(src),
    "run-agent.js should reference TOOLS.FINISH, not the bare literal"
  );
});

test("no module redeclares a behavioural set instead of importing it", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const root = url.fileURLToPath(new URL("../src/core/agent", import.meta.url));
  const namesFile = path.join(root, "tools", "names.js");

  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".js") && abs !== namesFile) {
        const src = fs.readFileSync(abs, "utf8");
        for (const set of Object.keys(SETS)) {
          if (new RegExp(`(const|let|var)\\s+${set}\\s*=`).test(src)) {
            offenders.push(`${path.relative(root, abs)} redeclares ${set}`);
          }
        }
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], "import the set from tools/names.js instead");
});
