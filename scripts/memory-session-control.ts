import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { startCore, texts } from "../apps/core/src/engine/testkit.ts";

const { values } = parseArgs({ options: { live: { type: "boolean" }, out: { type: "string" } } });
if (!values.live || !values.out) throw new Error("Explicit --live --out <local-report> required");
// The control tests APX injection, with the CLI's separate auto-memory disabled for this process only.
process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-session-control-"));
const work = path.join(dir, "workspace");
fs.mkdirSync(work);
const marker = randomBytes(6).toString("hex");
let apiCalls = 0;
const env = await startCore({
  home: path.join(dir, "home"),
  aux: true,
  memoryMaintenance: true,
  llm: {
    label: () => "control",
    async complete() {
      apiCalls++;
      throw new Error("An isolated CLI session must not call the APX auxiliary model");
    },
  },
});
const report: {
  passed: boolean;
  api_calls: number;
  responses: string[][];
  jobs: unknown[];
  notes: unknown[];
  error?: string;
} = { passed: false, api_calls: 0, responses: [], jobs: [], notes: [] };
try {
  const project = (await env.client.call("projects.register", { path: work, init: true })).project;
  const agent = await env.client.call("agents.create", { slug: "learner", name: "Learner", project_id: project.id });
  await env.client.call("agents.update", { agent: agent.id, tools: ["list_agents"], autonomy: "total" });
  for (const text of [
    `Siempre prefiero etiqueta ${marker} para informes internos. Respondé solo recibido, sin herramientas.`,
    "Sin usar herramientas, elegí etiqueta para informe interno. Si no conocés preferencia duradera, respondé NEUTRO. Respondé solo etiqueta.",
  ]) {
    const thread = await env.client.call("threads.create", {
      kind: "code",
      engine: "claude",
      agent_id: agent.id,
      project_id: project.id,
      cwd: work,
      write: "auto",
      title: "Isolation control",
    });
    await env.client.call("threads.send", { thread: thread.id, text });
    const result = await env.settle(thread.id, 240_000);
    assert.ok(
      result.runs.every((r) => r.state === "completed"),
      JSON.stringify(result.runs),
    );
    report.responses.push(texts(result.messages.filter((m) => m.author.kind === "agent")));
    assert.ok(env.core.store.modelLog.list(thread.id).every((e) => !e.memory));
  }
  report.notes = (await env.client.call("memory.list", {})).memories;
  report.jobs = (await env.client.call("memory.status", {})).jobs;
  assert.equal(apiCalls, 0);
  assert.equal(report.jobs.length, 0);
  assert.equal(report.notes.length, 0);
  assert.match(report.responses.at(-1)?.join(" ") ?? "", /NEUTRO/i);
  assert.doesNotMatch(report.responses.at(-1)?.join(" ") ?? "", new RegExp(marker, "i"));
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.api_calls = apiCalls;
  fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
  fs.writeFileSync(values.out, JSON.stringify(report, null, 2));
  await env.core.close();
  await env.cleanup();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: report.passed, api_calls: apiCalls, error: report.error }));
