import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { memoryEligibleChat } from "../domain/chat-access.ts";
import { supportMemoryClaims } from "../engine/memory-testkit.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-memory";
const OWNER = { id: 5005, name: "Owner" };
const CONTACT = { id: 6006, name: "Northwind buyer" };
const CORRECTION = "No me mandes audios por Telegram, prefiero texto porque en el trabajo no puedo escucharlos.";
const FACT =
  "El dueño prefiere texto y no audios por Telegram.\nWhy: en el trabajo no puede escucharlos.\nHow to apply: por Telegram responder siempre con texto.";
const CONTACT_SAYS = "Prefiero que me mandes las facturas por mail, nunca por Telegram.";
const REQUEST = "descargá este reel https://videos.example.com/reel/AAAA1111/";

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
  if (system.startsWith("Extract durable")) {
    // A model that would keep anything it is shown, a contact's words included: the core decides what it sees.
    const input = JSON.parse(String(req.messages.at(-1)?.content));
    const memories = (input.messages as Array<{ id: string; text: string }>).flatMap((m) =>
      m.text === CORRECTION
        ? [{ kind: "feedback", message_id: m.id, quote: CORRECTION, fact: FACT }]
        : m.text === CONTACT_SAYS
          ? [{ kind: "user", message_id: m.id, quote: CONTACT_SAYS, fact: CONTACT_SAYS }]
          : [],
    );
    return say(JSON.stringify({ memories }));
  }
  if (system.startsWith("Review private memory")) return say('{"groups":[]}');
  if (said.endsWith(REQUEST) && !afterTool)
    return callTool("d1", "download_file", {
      url: "https://reelsaver.example.com/en/download",
      path: "~/Downloads/reel-aaaa.mp4",
    });
  return say(afterTool ? "Listo, quedó en ~/Downloads/reel-aaaa.mp4" : "Entendido.");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
const pair = async (who: { id: number; name: string }, decision: "owner" | "contact") => {
  const before = tg.messagesTo(who.id).length;
  tg.message(who, "hola");
  await waitFor(() => tg.messagesTo(who.id).length > before, "a pairing code");
  const code = /(\d{6})/.exec(String(tg.messagesTo(who.id).at(-1)?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision });
};
/** Sends as `who` and waits for an answer to reach them. */
const say_ = async (who: { id: number; name: string }, text: string, answer: RegExp) => {
  tg.message(who, text);
  await waitFor(() => tg.messagesTo(who.id).some((m) => answer.test(String(m.body.text))), `an answer to ${text}`);
};
const settleJobs = () =>
  waitFor(async () => {
    const { jobs } = await env.client.call("memory.status", {});
    if (jobs.some((j) => j.state === "failed")) assert.fail(JSON.stringify(jobs));
    return jobs.every((j) => j.state === "completed");
  }, "memory jobs");
const notes = async () => (await env.client.call("memory.list", {})).memories;

before(async () => {
  tg = await fakeTelegram(TOKEN);
  env = await startCore({
    llm,
    aux: true,
    memoryMaintenance: true,
    channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
    extraTools: [
      defineTool({
        name: "download_file",
        description: "Download a URL to a path",
        args: z.object({ url: z.string(), path: z.string() }),
        effect: "none",
        deadlineMs: 5_000,
        title: () => "Downloaded",
        async run(a) {
          return `saved to ${a.path}`;
        },
      }),
    ],
  });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  await pair(OWNER, "owner");
  await pair(CONTACT, "contact");
});
after(async () => {
  await env.core.close();
  await tg.close();
  await env.cleanup();
});

test("an owner correction on Telegram becomes a note in the agent's words, quoting the message", async () => {
  await say_(OWNER, CORRECTION, /Entendido/);
  await env.client.call("memory.maintenance", {});
  await settleJobs();
  const note = (await notes()).find((m) => m.text === FACT);
  assert.ok(note, "captured from the owner's channel turn");
  assert.equal(note.kind, "feedback");
  assert.equal(note.evidence?.[0]?.quote, CORRECTION);
  const source = env.core.store.messages.get(note.evidence?.[0]?.message_id ?? "");
  assert.equal(source?.author.kind, "user", "the evidence is the owner's own message");
});

test("a download asked on Telegram and confirmed with a closing word leaves a procedure note", async () => {
  await say_(OWNER, REQUEST, /Listo, quedó/);
  const runs = () => env.core.store.runs.list(env.core.store.messages.get(lastOwnerMessage())?.thread_id ?? "", 50);
  const before = runs().length;
  tg.message(OWNER, "Buenísimo");
  // A closing word starts no turn; memory still hears it.
  await waitFor(async () => (await notes()).some((m) => m.kind === "procedure"), "the procedure note");
  assert.equal(runs().length, before, "the closer got no turn of its own");
  const note = (await notes()).find((m) => m.kind === "procedure");
  assert.equal(note?.evidence?.[0]?.quote, REQUEST);
  assert.match(note?.text ?? "", /`download_file` `reelsaver\.example\.com\/en\/download`/);
  assert.match(note?.text ?? "", /Outputs: `~\/Downloads\/reel-aaaa\.mp4`/);
});

test("what a contact says on Telegram never becomes a memory or a recall source", async () => {
  await say_(CONTACT, CONTACT_SAYS, /Entendido/);
  await env.client.call("memory.maintenance", { backfill: true });
  await settleJobs();
  assert.equal(
    (await notes()).some((m) => m.text === CONTACT_SAYS),
    false,
  );
  const said = env.core.store.messages
    .list(contactThread(), 50)
    .find((m) => m.parts.some((p) => p.type === "text" && p.text === CONTACT_SAYS));
  assert.ok(said);
  assert.equal(env.core.store.memorySources.runFor(said.id), undefined, "a contact's message is no owner source");
});

test("the owner's own chat on a channel counts for memory; a contact's or a room's does not", () => {
  let n = 0;
  const chat = (person_id: string) =>
    env.core.store.threads.create({
      kind: "channel",
      title: "Telegram",
      agent_ids: ["roby"],
      channel: { id: "tg-own", conversation: `c-${++n}`, person_id },
    });
  assert.equal(memoryEligibleChat(env.core.store, chat("owner")), true);
  assert.equal(memoryEligibleChat(env.core.store, chat("p_contact")), false);
  const room = chat("owner");
  env.core.store.threads.mergeContext(room.id, { room: { name: "Acme team" } });
  assert.equal(memoryEligibleChat(env.core.store, room), false);
});

function lastOwnerMessage(): string {
  const home = env.core.store.threads
    .list({ include_archived: false, include_subthreads: false, limit: null })
    .find((t) => t.kind === "home");
  return env.core.store.messages.list(home?.id ?? "", 50).findLast((m) => m.author.kind === "user")?.id ?? "";
}

function contactThread(): string {
  return (
    env.core.store.threads
      .list({ include_archived: false, include_subthreads: false, limit: null })
      .find((t) => t.channel?.person_id && t.channel.person_id !== "owner")?.id ?? ""
  );
}
