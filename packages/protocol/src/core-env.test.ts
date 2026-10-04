import assert from "node:assert/strict";
import { test } from "node:test";
import { coreEnvDefaults, parseCoreEnv, serializeCoreEnv } from "./core-env.ts";

test("parses KEY=VALUE lines, skipping comments and blanks and trimming quotes", () => {
  const vars = parseCoreEnv(
    '# header\n\nAPX_HOST = 0.0.0.0\r\nAPX_TOKEN="abc=def"\nnot a line\n=nokey\nAPX_PUBLIC_URL=https://apx.example.ts.net\n',
  );
  assert.deepEqual(vars, {
    APX_HOST: "0.0.0.0",
    APX_TOKEN: "abc=def",
    APX_PUBLIC_URL: "https://apx.example.ts.net",
  });
});

test("serializes in a stable order with a header and a trailing newline, and reads back the same", () => {
  const vars = { OTHER: "x", APX_TOKEN: "t", APX_HOST: "0.0.0.0" };
  const text = serializeCoreEnv(vars);
  assert.ok(text.startsWith("# "));
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(text.split("\n").slice(1, -1), ["APX_HOST=0.0.0.0", "APX_TOKEN=t", "OTHER=x"]);
  assert.deepEqual(parseCoreEnv(text), vars);
  assert.equal(serializeCoreEnv({}).split("\n").length, 2);
});

test("only the known keys become core defaults, and empty values do not", () => {
  assert.deepEqual(coreEnvDefaults({ APX_PORT: "7500", APX_HOME: "/elsewhere", APX_TOKEN: "" }), { APX_PORT: "7500" });
});
