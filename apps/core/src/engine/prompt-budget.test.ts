import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fakeWhatsApp } from "../channels/fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "../channels/whatsapp.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { scratchDir } from "../tools/folders.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/**
 * What a fresh install's secretary sends on every model call, in characters (about four to a token): together about
 * 9,500 tokens. A change that needs more raises these here and in rules/PROMPT_SIZE.md, with the reason in its commit.
 */
const BUDGET = { system: 10_000, tools: 30_000 };
/**
 * The same for an owner who set things up: a WhatsApp channel with stickers, the computer allowed, instructions of
 * their own, an "about" and a project with a 20k-char AGENTS.md. Feature growth shows here first.
 */
const REALISTIC = { system: 7_500, tools: 29_000, input: 600 };

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
// Exercise a long native temp path, then measure its canonical spelling in the captured prompt.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), `apx-budget-${"long-".repeat(12)}`));
const FIXED = { TMPDIR: temp, TEMP: temp, TMP: temp, APX_CODE_SHA: "0123456789ab" };
const saved = Object.fromEntries(Object.keys(FIXED).map((k) => [k, process.env[k]]));
const restore = () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};
before(async () => {
  Object.assign(process.env, FIXED);
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  restore();
  await removeDir(temp);
});

test("a default turn's system prompt and tools stay within the prompt budget", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "hola" });
  await env.settle(t.id);
  const call = llm.calls.at(-1);
  const prompt = String(call?.messages[0]?.content ?? "");
  const scratch = scratchDir(env.core.store, env.home, t);
  assert.ok(prompt.includes(scratch), "the captured prompt names the real chat temp folder");
  const system = prompt.replace(scratch, `/tmp/apx-scratch-01234567/${t.id}`).length;
  const tools = JSON.stringify(call?.tools ?? []).length;
  assert.ok(system <= BUDGET.system, `system prompt: ${system} chars, budget ${BUDGET.system} (rules/PROMPT_SIZE.md)`);
  assert.ok(tools <= BUDGET.tools, `tools: ${tools} chars, budget ${BUDGET.tools} (rules/PROMPT_SIZE.md)`);
});

const INSTRUCTIONS = [
  "You are the owner's chief of staff. Keep their week in order: meetings, follow-ups, invoices and travel.",
  "Every morning check the calendar and the inbox and say what needs them today, in three lines at most.",
  "When a client writes about an invoice, look it up in the Northwind folder before answering; never promise a date.",
  "Prefer short answers, in the owner's tone: friendly and direct, no emojis unless they use them first.",
  "When something needs a decision, give one recommendation and the reason, not a list of options.",
  "Travel: only refundable fares, a window seat, hotels within walking distance of the venue.",
  "Never share the owner's phone number or address with contacts. Never accept meetings before 9 or after 18.",
].join("\n");
const ABOUT =
  "I run Acme, a small design studio. I work with three clients (Northwind, Contoso, Fabrikam). I prefer short " +
  "messages and check WhatsApp more than email. My partner handles the accounting; I handle sales and design reviews.";
const agentsMd = (chars: number) => {
  let text = "# AGENTS.md: Acme web\n\nGuide for agents working on the Acme website.\n";
  for (let i = 1; text.length < chars; i++)
    text += `\n## Section ${i}\n\n${Array.from({ length: 6 }, (_, j) => `- Rule ${i}.${j + 1}: keep components small, run the tests before a commit and log the change with its reason.`).join("\n")}\n`;
  return text.slice(0, chars);
};

test("a realistic owner's turns stay within their own budget", async () => {
  const wa = fakeWhatsApp();
  const project = fs.mkdtempSync(path.join(temp, "acme-"));
  const rules = agentsMd(20_000);
  fs.writeFileSync(path.join(project, "AGENTS.md"), rules);
  const real = await startCore({
    llm,
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: `${real.home}/wa`, selfOwner: c.self_owner === true, lib: async () => wa.lib }),
    },
  });
  try {
    const channel = async () => (await real.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
    await real.client.call("channels.set", {
      id: "whatsapp",
      channel: { type: "whatsapp", agent_id: "roby", self_owner: true },
    });
    await waitFor(async () => Boolean((await channel())?.qr), "a QR");
    wa.scan();
    await waitFor(async () => (await channel())?.status === "running", "linked");
    const { store } = real.core;
    for (const [i, meaning] of [
      "thumbs up, all good",
      "bear with a heart balloon",
      "cat laughing, tears of joy",
    ].entries()) {
      const media = store.media.add({
        kind: "image",
        mime: "image/webp",
        path: path.join(real.home, `${i}.webp`),
        bytes: 9,
      });
      const s = store.stickers.add({ platform: "whatsapp", hash: `h${i}`, media_id: media.id });
      store.stickers.describe(s.id, meaning);
    }
    await real.client.call("owner.set", { name: "Alex", about: ABOUT });
    await real.client.call("agents.update", { agent: "roby", prompt: INSTRUCTIONS });
    await real.client.call("environments.permit", { agent: "roby", on: true });
    const { project: p } = await real.client.call("projects.register", { path: project });

    const t = await real.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: p.id });
    await real.client.call("threads.send", { thread: t.id, text: "¿qué falta para el deploy?" });
    await real.settle(t.id);
    const call = llm.calls.at(-1);
    const scratch = scratchDir(store, real.home, t);
    const prompt = String(call?.messages[0]?.content ?? "");
    // The project's AGENTS.md reaches it whole and is not APX's to budget (DECISIONS.md#d-158).
    assert.ok(prompt.includes(rules), "the whole AGENTS.md");
    const system = prompt.replace(rules, "").replace(scratch, `/tmp/apx-scratch-01234567/${t.id}`).length;
    const tools = JSON.stringify(call?.tools ?? []).length;
    assert.ok(system <= REALISTIC.system, `system prompt: ${system} chars, budget ${REALISTIC.system}`);
    assert.ok(tools <= REALISTIC.tools, `tools: ${tools} chars, budget ${REALISTIC.tools}`);

    const before = llm.calls.length;
    wa.fromOwner("¿qué tengo hoy?");
    await waitFor(() => llm.calls.length > before, "the owner's turn on WhatsApp");
    await real.settle("home");
    const input = String(llm.calls.at(-1)?.messages.at(-1)?.content ?? "").replace("¿qué tengo hoy?", "").length;
    assert.ok(input <= REALISTIC.input, `a WhatsApp turn's input: ${input} chars, budget ${REALISTIC.input}`);
  } finally {
    await real.core.close();
    await real.cleanup();
  }
});
