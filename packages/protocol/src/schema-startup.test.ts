import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { z } from "zod";
import { Project } from "./domain.ts";
import { methods, type Params, type ParsedParams, type Result } from "./methods.ts";

const execute = promisify(execFile);

test("importing the full contract does not construct unused field trees", async () => {
  const entry = new URL("./index.ts", import.meta.url);
  const { stdout } = await execute(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import v8 from "node:v8";
    import { z } from "zod";
    import { methods } from ${JSON.stringify(entry.href)};
    console.log(JSON.stringify({ methods: Object.keys(methods).length, strings: v8.queryObjects(z.ZodString) }));
  `,
    ],
    { timeout: 60_000, cwd: import.meta.dirname },
  );
  const retained: { methods: number; strings: number } = JSON.parse(stdout);
  assert.equal(retained.methods, Object.keys(methods).length);
  // Bound live schema construction, not timing or V8's platform-dependent byte sizes.
  assert.ok(retained.strings < 600, `unused field trees retained ${retained.strings} string schemas`);
});

test("shared object fields are real, stable Zod schemas across derived shapes", () => {
  assert.ok(Project instanceof z.ZodObject);
  const extended = Project.extend({ extra: z.string().optional() });
  const omitted = Project.omit({ id: true });
  const partial = Project.partial();
  const name = Project.shape.name;
  assert.ok(name instanceof z.ZodString);
  assert.equal(Project.shape.name, name);
  assert.equal(extended.shape.name, name);
  assert.equal(omitted.shape.name, name);
  assert.equal(partial.shape.name.unwrap(), name);
  assert.deepEqual(Project.parse({ id: "example", name: "Example" }), {
    id: "example",
    name: "Example",
    present: true,
  });
  assert.equal(Project.strict().safeParse({ id: "example", name: "Example", extra: true }).success, false);
  assert.equal(Project.shape.name.safeParse(42).success, false);
  assert.deepEqual(z.toJSONSchema(omitted, { io: "input" }).properties?.name, { type: "string" });
});

test("method params, parsed defaults and results retain their concrete types", () => {
  const input: Params<"threads.list"> = {};
  const parsed: ParsedParams<"threads.list"> = methods["threads.list"].params.parse(input);
  const output: Result<"threads.list"> = { threads: [] };
  assert.deepEqual(parsed, { include_subthreads: false, delegated: 0, include_archived: false });
  assert.deepEqual(methods["threads.list"].result.parse(output), output);
  assert.ok(methods["tasks.update"].params.shape.description instanceof z.ZodOptional);
  assert.equal(methods["tasks.update"].params.shape.description.safeParse("A task").success, true);
  assert.equal(
    methods["threads.create"].params.safeParse({ kind: "agent", agent_id: "example", extra: true }).success,
    false,
  );
});
