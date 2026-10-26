// Checks that a model understands APX's tool descriptions: the tools exactly as a turn sends them go to Codex with
// ordinary requests, and it says which tool it would call first. Misses and the descriptions it found unclear come
// back, with each tool's size. Run it before and after editing a description.
//
//   pnpm tools:review [--model <model>] [--keep]
//
// Needs the `codex` CLI signed in. It runs in a temp folder, read-only, without the user's config or MCP servers.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeTelegram } from "../apps/core/src/channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../apps/core/src/channels/telegram.ts";
import { say, scriptedLlm, startCore } from "../apps/core/src/engine/testkit.ts";
import { CODEX_IMAGE_SERVICE } from "../apps/core/src/services/codex-images.ts";
import { browserTools } from "../apps/core/src/tools/browser.ts";
import { directoryTools, STICKER_TOOL } from "../apps/core/src/tools/directory.ts";
import { toSpec } from "../apps/core/src/tools/types.ts";

type Scenario = { ask: string; expect: string[] };
type Choice = { id: number; tool: string; args: string; confidence: number };
type Review = { choices: Choice[]; unclear: Array<{ tool: string; why: string }> };
type Spec = { name: string; description: string; parameters: unknown };

const argv = process.argv.slice(2);
const model = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : undefined;
const keep = argv.includes("--keep");
const scenarios = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "tool-review.scenarios.json"), "utf8"),
) as Scenario[];

/**
 * The tools of an owner's turn with Roby, as the model receives them (the desktop app lends the browser ones), with a
 * channel and an image service on so the tools that wait for them are reviewed too, and sticker_list, which a turn
 * from a channel with stickers gets.
 */
async function turnTools(): Promise<Spec[]> {
  const llm = scriptedLlm(() => say("ok"));
  const token = "123456:REVIEW";
  const tg = await fakeTelegram(token);
  const env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  try {
    await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token });
    env.core.store.settings.write("services", [{ ...CODEX_IMAGE_SERVICE, id: "codex" }]);
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: t.id, text: "hola" });
    await env.settle(t.id);
    const sticker = directoryTools(env.core.store).find((t) => t.name === STICKER_TOOL);
    const sent = [
      ...(llm.calls.at(-1)?.tools ?? []),
      ...browserTools(env.core.store, env.home).map(toSpec),
      ...(sticker ? [toSpec(sticker)] : []),
    ];
    return sent.map((s) => ({
      name: s.function.name,
      description: s.function.description,
      parameters: s.function.parameters,
    }));
  } finally {
    await env.core.close();
    await tg.close();
    await env.cleanup();
  }
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["choices", "unclear"],
  properties: {
    choices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "tool", "args", "confidence"],
        properties: {
          id: { type: "integer" },
          tool: { type: "string" },
          args: { type: "string" },
          confidence: { type: "integer" },
        },
      },
    },
    unclear: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "why"],
        properties: { tool: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};

const prompt = (tools: Spec[]) =>
  [
    "You are checking the tool descriptions of an assistant app. Do not run anything; only read and answer.",
    "The assistant (the owner's secretary, answering in Spanish) has exactly these tools, as JSON:",
    "",
    JSON.stringify(tools),
    "",
    "For each numbered request from the owner, say which ONE tool you would call first, based only on the descriptions",
    '(tool "none" if you would just answer in words), the arguments as compact JSON text, and your confidence 1-5.',
    "Then list every tool whose description is unclear, misleading, too long for what it says, or overlaps another,",
    "with one short line saying why. List none if all are clear.",
    "",
    ...scenarios.map((s, i) => `${i + 1}. ${s.ask}`),
  ].join("\n");

const tokens = (s: Spec) => Math.round(JSON.stringify(s).length / 4);

const tools = await turnTools();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tool-review-"));
fs.writeFileSync(path.join(dir, "schema.json"), JSON.stringify(SCHEMA));
const out = path.join(dir, "review.json");
const run = spawnSync(
  "codex",
  [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    "-C",
    dir,
    "--output-schema",
    path.join(dir, "schema.json"),
    "-o",
    out,
    ...(model ? ["-m", model] : []),
    "-",
  ],
  { input: prompt(tools), encoding: "utf8", timeout: 15 * 60_000 },
);
if (run.status !== 0 || !fs.existsSync(out)) {
  console.error(run.stderr.slice(-2000) || run.error?.message || "codex exec failed");
  process.exit(1);
}
const review = JSON.parse(fs.readFileSync(out, "utf8")) as Review;

let hits = 0;
const misses: string[] = [];
for (const [i, s] of scenarios.entries()) {
  const c = review.choices.find((x) => x.id === i + 1);
  if (c && s.expect.includes(c.tool)) hits++;
  else
    misses.push(
      `  ${i + 1}. ${s.ask}\n     expected ${s.expect.join(" | ")}, chose ${c?.tool ?? "nothing"} (${c?.confidence ?? 0}/5)`,
    );
}
const total = tools.reduce((n, t) => n + tokens(t), 0);
console.log(`Tools: ${tools.length}, about ${total} tokens. Picked as expected: ${hits}/${scenarios.length}`);
if (misses.length) console.log(`\nMisses:\n${misses.join("\n")}`);
if (review.unclear.length) console.log(`\nUnclear:\n${review.unclear.map((u) => `  ${u.tool}: ${u.why}`).join("\n")}`);
console.log(
  `\nLargest:\n${[...tools]
    .sort((a, b) => tokens(b) - tokens(a))
    .slice(0, 10)
    .map((t) => `  ${t.name.padEnd(22)} ${tokens(t)}`)
    .join("\n")}`,
);
if (keep) console.log(`\nKept in ${dir}`);
else fs.rmSync(dir, { recursive: true, force: true });
