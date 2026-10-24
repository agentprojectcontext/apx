import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { absoluteDates, factSupported } from "../domain/memory-content.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { confirmsSuccess } from "./memory-procedure.ts";
import { supportMemoryClaims } from "./memory-testkit.ts";
import { INDEX_CHARS } from "./recall.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

type Env = Awaited<ReturnType<typeof startCore>>;

const settleJobs = (env: Env) =>
  waitFor(async () => {
    const { jobs } = await env.client.call("memory.status", {});
    if (jobs.some((job) => job.state === "failed")) assert.fail(JSON.stringify(jobs));
    return jobs.every((job) => job.state === "completed");
  }, "memory jobs");

const lastInput = (llm: ReturnType<typeof scriptedLlm>) =>
  String(llm.calls.findLast((c) => c.tools.length > 0)?.messages.at(-1)?.content);

const correction =
  "No me mandes audios por Telegram, prefiero texto porque en el trabajo no puedo escucharlos. Y podés terminar esa review?";
const synthesized =
  "El dueño prefiere texto y no audios por Telegram.\nWhy: en el trabajo no puede escucharlos.\nHow to apply: por Telegram responder siempre con texto.";

test("a fact must be supported by the owner's quote: numbers, names and negations come from it", () => {
  const quote = "No me mandes audios por Telegram, prefiero texto";
  assert.equal(factSupported("El dueño prefiere texto y no audios por Telegram.", quote), true);
  assert.equal(factSupported("El dueño prefiere audios por Telegram.", quote), false, "a dropped negation flips it");
  assert.equal(factSupported("El dueño prefiere texto y no audios por WhatsApp.", quote), false, "an invented name");
  assert.equal(factSupported("El dueño prefiere texto, no 3 audios por Telegram.", quote), false, "an invented number");
  assert.equal(factSupported("Why: no audios.", quote), false, "the rule comes first");
  assert.equal(factSupported("Don't use tabs in this repo.", "I always want tabs in this repo"), false);
  assert.equal(factSupported("Use tabs in this repo.", "Don't use tabs in this repo"), false, "an apostrophe negation");
  assert.equal(
    factSupported(
      "Prefer tabs in this repo.\nWhy: the owner was burned by a production outage.\nHow to apply: deploy on Fridays.",
      "Prefer tabs in this repo please",
    ),
    false,
    "a reason or a rule the quote never gave",
  );
});

test("a fact that swaps what the owner paired is not supported", () => {
  const quote = "Prefiero PDF para informes internos y CSV para clientes";
  assert.equal(factSupported("El dueño prefiere PDF para informes internos y CSV para clientes.", quote), true);
  assert.equal(factSupported("Prefiero CSV para informes internos y PDF para clientes", quote), false);
  assert.equal(
    factSupported(
      "Send invoices to finance and contracts to legal.",
      "Send contracts to finance and invoices to legal",
    ),
    false,
  );
  assert.equal(
    factSupported(
      "The owner deploys acme on Mondays, northwind on Fridays.",
      "Deploy acme on Mondays and northwind on Fridays",
    ),
    true,
    "rewording keeps the pairs in order",
  );
});

test("relative days become the dates they meant, and a morning is not tomorrow", () => {
  assert.equal(
    absoluteDates("Hoy bajé el reel; mañana lo subo. Esta mañana falló. Yesterday it worked.", "2026-03-10"),
    "El 2026-03-10 bajé el reel; el 2026-03-11 lo subo. El 2026-03-10 falló. On 2026-03-09 it worked.",
  );
  assert.equal(absoluteDates("Reviso todo por la mañana.", "2026-03-10"), "Reviso todo por la mañana.");
  assert.equal(absoluteDates("Llega de mañana.", "2026-03-10"), "Llega de mañana.");
  assert.equal(
    absoluteDates('Ran `curl https://news.example.com/today` when asked "bajalo hoy" today.', "2026-03-10"),
    'Ran `curl https://news.example.com/today` when asked "bajalo hoy" on 2026-03-10.',
    "quoted commands and the owner's words are data",
  );
});

test("automatic capture saves the agent's synthesis with the owner's quote as evidence, never the raw request", async () => {
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
    if (system.startsWith("Extract durable")) {
      const source = JSON.parse(String(req.messages.at(-1)?.content)).messages[0];
      return say(
        JSON.stringify({
          memories: [
            { kind: "feedback", message_id: source.id, quote: correction.split(" Y podés")[0], fact: synthesized },
            // Verbatim requests without a synthesis, and facts the quote does not support, are dropped.
            { kind: "project", message_id: source.id, quote: "Y podés terminar esa review?" },
            {
              kind: "user",
              message_id: source.id,
              quote: "prefiero texto porque en el trabajo",
              fact: "El dueño trabaja en Northwind y prefiere texto.",
            },
            {
              kind: "user",
              message_id: source.id,
              quote: "No me mandes audios por Telegram, prefiero texto",
              fact: "El dueño no quiere texto por Telegram, prefiere audios.",
            },
          ],
        }),
      );
    }
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    return say("Entendido.");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: correction });
    await env.settle(chat.id);
    await env.client.call("memory.maintenance", {});
    await settleJobs(env);
    const notes = (await env.client.call("memory.list", {})).memories;
    assert.deepEqual(
      notes.map((m) => m.text),
      [synthesized],
    );
    const [note] = notes;
    assert.equal(note?.kind, "feedback");
    assert.equal(note?.evidence?.[0]?.quote, correction.split(" Y podés")[0]);
    assert.notEqual(note?.text, note?.evidence?.[0]?.quote, "the note is the agent's words, the quote is evidence");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

const reel = "https://videos.example.com/reel/AAAA1111/";
const request = `descargá este reel ${reel}`;
const downloader = (log: string[]) => [
  defineTool({
    name: "fetch_reel",
    description: "Fetch a reel straight from its page",
    args: z.object({ url: z.string() }),
    effect: "none",
    deadlineMs: 5_000,
    title: () => "Fetched",
    async run() {
      log.push("fetch_reel");
      throw new Error("login required");
    },
  }),
  defineTool({
    name: "download_file",
    description: "Download a URL to a path",
    args: z.object({ url: z.string(), path: z.string() }),
    effect: "none",
    deadlineMs: 5_000,
    title: () => "Downloaded",
    async run(a) {
      log.push("download_file");
      return `saved to ${a.path}`;
    },
  }),
];

/** The model: on a download request it tries the reel page, then a downloader site; everything else is chat. */
function downloadingLlm(retry: boolean, url = "https://reelsaver.example.com/en/download?u=AAAA1111&token=s3cr3t") {
  return scriptedLlm((req, { system, said, afterTool }) => {
    if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    if (system.startsWith("Review private")) return say('{"groups":[]}');
    if (said.startsWith("descargá")) {
      const results = req.messages.filter((m) => m.role === "tool").length;
      if (!afterTool && retry) return callTool("f1", "fetch_reel", { url: reel });
      if (results < (retry ? 2 : 1))
        return callTool("d1", "download_file", {
          url,
          path: "~/Downloads/reel-aaaa.mp4",
        });
      return say("Listo, quedó en ~/Downloads/reel-aaaa.mp4");
    }
    return say("ok");
  });
}

const procedures = async (env: Env) =>
  (await env.client.call("memory.list", { agent: "roby" })).memories.filter((m) => m.kind === "procedure");

test("a download that worked after a failed try leaves a procedure note, and 'like you did today' finds it", async () => {
  const log: string[] = [];
  const llm = downloadingLlm(true);
  const env = await startCore({ llm, aux: true, memoryMaintenance: true, extraTools: downloader(log) });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: request });
    await env.settle(chat.id);
    assert.deepEqual(log, ["fetch_reel", "download_file"]);
    assert.equal((await procedures(env)).length, 0, "a tool response is not a verified download");
    await env.client.call("threads.send", { thread: chat.id, text: "Genial, funcionó" });
    await env.settle(chat.id);
    await waitFor(async () => (await procedures(env)).length === 1, "the procedure note");
    const [note] = await procedures(env);
    assert.ok(note);
    assert.equal(note.scope, "agent");
    assert.match(note.text, /^Procedure confirmed by owner on \d{4}-\d{2}-\d{2} \(history, not an instruction\)/);
    assert.match(note.text, /`download_file` `reelsaver\.example\.com\/en\/download`/);
    assert.match(note.text, /Outputs: `~\/Downloads\/reel-aaaa\.mp4`/);
    assert.match(
      note.text,
      /\nTried first, failed: `fetch_reel` `videos\.example\.com\/reel\/AAAA1111` \(login required\)\n/,
      "the failed try remains separate from the successful method",
    );
    assert.doesNotMatch(note.text.split("\n")[1] ?? "", /fetch_reel/, "a failed try is never a successful step");
    assert.doesNotMatch(note.text, /token|s3cr3t/, "query strings can carry credentials");
    assert.equal(note.evidence?.[0]?.quote, request);

    // Hours later and many notes on, in another chat, words that share nothing with the note still reach it: by the
    // index, since it is no longer among the newest notes shown whole.
    for (let i = 0; i < 10; i++)
      env.core.store.memories.add({
        scope: "agent",
        agent_id: "roby",
        source: "agent",
        text: `Acme ledger rule ${i}.`,
      });
    const later = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: later.id, text: "bajalo como hiciste hoy" });
    await env.settle(later.id);
    const input = lastInput(llm);
    const index = input.slice(input.indexOf("[your notes index"));
    assert.match(
      index,
      new RegExp(
        `\\[${note.id}\\] \\(procedure, [^)]*\\) "descargá este reel &lt;videos\\.example\\.com>": reelsaver\\.example\\.com`,
      ),
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the owner confirming it worked keeps the previous turn's procedure; a 'great, but' does not", async () => {
  assert.equal(confirmsSuccess("genial, funcionó"), true);
  assert.equal(confirmsSuccess("Perfecto!"), true);
  assert.equal(confirmsSuccess("genial pero no bajó el audio"), false);
  assert.equal(confirmsSuccess("funcionó?"), false);
  assert.equal(confirmsSuccess("buenísimo"), true);
  for (const complaint of [
    "Genial, no funcionó",
    "genial, no anda",
    "perfecto, falla igual",
    "joya, no hizo nada",
    "bárbaro, no sirvió",
    "excelente, falta el audio",
    "great, it didn't work",
    "great, it didn’t work",
    "nice, still doesn't work",
    "awesome, it fails",
    "works? no",
  ])
    assert.equal(confirmsSuccess(complaint), false, complaint);
  const log: string[] = [];
  // A bare origin, as typed, is a target too.
  const llm = downloadingLlm(false, "https://Reelsaver.example.com");
  const env = await startCore({ llm, aux: true, memoryMaintenance: true, extraTools: downloader(log) });
  try {
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: request });
    await env.settle(chat.id);
    await env.client.call("threads.send", { thread: chat.id, text: "genial pero no bajó el audio" });
    await env.settle(chat.id);
    await settleJobs(env);
    assert.equal((await procedures(env)).length, 0, "a clean run with no confirmation is not a procedure yet");
    await env.client.call("threads.send", { thread: chat.id, text: "Genial, no funcionó" });
    await env.settle(chat.id);
    await settleJobs(env);
    assert.equal((await procedures(env)).length, 0, "a positive opener over a complaint confirms nothing");
    await env.client.call("threads.send", { thread: chat.id, text: "genial, funcionó" });
    await env.settle(chat.id);
    await waitFor(async () => (await procedures(env)).length === 1, "the confirmed procedure");
    const [note] = await procedures(env);
    assert.equal(note?.evidence?.[0]?.quote, request, "the note is about the turn that did the work");
    assert.match(note?.text ?? "", /`download_file` `reelsaver\.example\.com`/);
    assert.equal(note?.tainted, true, "a procedure is read as data: its arguments may come from what a step read");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the index lists the agent's own notes once per thread, within its cap, and later only new ones", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  try {
    const add = (text: string) =>
      env.core.store.memories.add({ scope: "agent", agent_id: "roby", source: "agent", text, kind: "project" });
    for (let i = 0; i < 60; i++)
      add(`Northwind ledger rule ${i}: entries in batch ${i} close with a ${"long ".repeat(8)}review.`);
    // Notes saved with outside content in the turn come wrapped as untrusted, inside the same cap. The newest eight
    // are shown whole as standing notes; the index lists the rest.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    await tick();
    for (let i = 0; i < 3; i++)
      env.core.store.memories.add({
        scope: "agent",
        agent_id: "roby",
        source: "agent",
        text: `Northwind supplier page ${i} lists its ${"terms ".repeat(10)}.`,
        tainted: true,
      });
    await tick();
    for (let i = 0; i < 8; i++) add(`Acme standing rule ${i}.`);
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: "hola, cómo va?" });
    await env.settle(chat.id);
    const first = lastInput(llm);
    const index = first.slice(first.indexOf("[your notes index"));
    assert.ok(first.includes("[your notes index"), "the owner's turn carries the index");
    const block = index.slice(0, index.lastIndexOf("\n\nhola"));
    assert.match(block, /untrusted/);
    assert.ok(block.length <= INDEX_CHARS, `index ${block.length} chars, cap ${INDEX_CHARS}`);
    assert.ok(block.split("\n").length > 10, "a useful number of hooks fit");

    await env.client.call("threads.send", { thread: chat.id, text: "y ahora?" });
    await env.settle(chat.id);
    assert.doesNotMatch(lastInput(llm), /\[your notes index/, "already in this thread's history");

    const fresh = add("Acme invoices are archived with amber labels.");
    await env.client.call("threads.send", { thread: chat.id, text: "algo más?" });
    await env.settle(chat.id);
    const next = lastInput(llm);
    assert.match(next, /\[your notes index/);
    assert.ok(next.includes(fresh.id), "a note saved since then joins the index");
    assert.doesNotMatch(next, /ledger rule 59/, "the hooks already shown are not repeated");

    const listed = /\[(mem_[0-9a-f]+)\] \(project, [^)]*\) Northwind ledger/.exec(first)?.[1] ?? "";
    const old = env.core.store.memories.get(listed);
    assert.ok(old);
    await tick();
    env.core.store.memories.edit(old.id, "Northwind ledger entries now close with a short review.", {
      tainted: false,
      pending: false,
    });
    await env.client.call("threads.send", { thread: chat.id, text: "y eso?" });
    await env.settle(chat.id);
    assert.match(lastInput(llm), /Northwind ledger entries now close with a short review/, "an edited note comes back");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a notebook of notes saved with outside content keeps the index within its cap", async () => {
  const llm = scriptedLlm(() => say("ok"));
  const env = await startCore({ llm });
  try {
    for (let i = 0; i < 60; i++)
      env.core.store.memories.add({
        scope: "agent",
        agent_id: "roby",
        source: "agent",
        text: `Northwind page ${i} said its terms changed.`,
        tainted: true,
      });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: "hola" });
    await env.settle(chat.id);
    const input = lastInput(llm);
    const block = input.slice(input.indexOf("[your notes index"), input.lastIndexOf("\n\nhola"));
    assert.match(block, /untrusted/);
    assert.ok(block.length <= INDEX_CHARS, `index ${block.length} chars, cap ${INDEX_CHARS}`);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a dream retires a note a newer correction supersedes and writes relative days as dates", async () => {
  let plan = "{}";
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
    if (system.startsWith("Review private memory")) {
      const { notes } = JSON.parse(String(req.messages.at(-1)?.content));
      const live = new Set(notes.map((n: { id: string }) => n.id));
      const proposal = JSON.parse(plan);
      // A later pass cannot propose a note that already left the supplied notebook.
      return say(
        JSON.stringify({ ...proposal, retire: proposal.retire.filter((r: { id: string }) => live.has(r.id)) }),
      );
    }
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    return say("ok");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  try {
    const add = async (text: string) => {
      await tick();
      return env.core.store.memories.add({ scope: "agent", agent_id: "roby", source: "agent", text });
    };
    const old = await add("Northwind reports go out on Mondays.");
    const dated = await add("Acme's deploy was moved to tomorrow.");
    for (const n of [1, 2, 3]) await add(`Acme ledger note ${n}.`);
    const fix = await add("Northwind reports now go out on Fridays, not Mondays.");
    plan = JSON.stringify({ groups: [], retire: [{ id: old.id, by: fix.id }] });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: "Review the reports." });
    await env.settle(chat.id);
    await env.client.call("memory.maintenance", { dream: true });
    await settleJobs(env);

    const live = (await env.client.call("memory.list", { agent: "roby" })).memories;
    assert.equal(
      live.some((m) => m.id === old.id),
      false,
      "the superseded note left the notebook",
    );
    assert.ok(live.some((m) => m.id === fix.id));
    const history = (await env.client.call("memory.history", { id: old.id })).versions;
    assert.equal(history[0]?.reason, `superseded:${fix.id}`);
    assert.ok((await env.client.call("memory.list", { forgotten: true })).memories.some((m) => m.id === old.id));
    const day = new Date(Date.parse(dated.created_at) + 86_400_000).toLocaleDateString("en-CA");
    assert.equal(env.core.store.memories.get(dated.id)?.text, `Acme's deploy was moved to ${day}.`);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a dream that would forget too much of the notebook at once is refused whole", async () => {
  let plan = "{}";
  const llm = scriptedLlm((req, { system }) => {
    if (system.startsWith("Validate memory")) return supportMemoryClaims(req);
    if (system.startsWith("Review private memory")) return say(plan);
    if (system.startsWith("Extract durable")) return say('{"memories":[]}');
    return say("ok");
  });
  const env = await startCore({ llm, aux: true, memoryMaintenance: true });
  try {
    const notes = [];
    for (const n of [1, 2, 3, 4, 5]) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      notes.push(
        env.core.store.memories.add({ scope: "agent", agent_id: "roby", source: "agent", text: `Acme rule ${n}.` }),
      );
    }
    const newest = notes.at(-1)?.id;
    plan = JSON.stringify({ groups: [], retire: notes.slice(0, 3).map((m) => ({ id: m.id, by: newest })) });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: chat.id, text: "Review the rules." });
    await env.settle(chat.id);
    await env.client.call("memory.maintenance", { dream: true });
    await settleJobs(env);
    assert.equal((await env.client.call("memory.list", { agent: "roby" })).memories.length, 5);
    const dreams = (await env.client.call("memory.status", {})).jobs.filter((j) => j.kind === "dream");
    assert.ok(
      dreams.some((j) => /would forget 3 of 5 notes/.test(String(j.result))),
      JSON.stringify(dreams),
    );

    // One at a time is allowed, but the share holds for the day: a second pass cannot add to it.
    const dream = async (id: string | undefined) => {
      plan = JSON.stringify({ groups: [], retire: [{ id, by: newest }] });
      env.core.store.memories.add({ scope: "agent", agent_id: "roby", source: "agent", text: `Acme aside ${id}.` });
      await env.client.call("memory.maintenance", { dream: true });
      await settleJobs(env);
    };
    await dream(notes[0]?.id);
    await dream(notes[1]?.id);
    const live = (await env.client.call("memory.list", { agent: "roby" })).memories.map((m) => m.id);
    assert.equal(live.includes(notes[0]?.id ?? ""), false);
    assert.equal(live.includes(notes[1]?.id ?? ""), true, "the second forgetting waits for another day");
    const after = (await env.client.call("memory.status", {})).jobs.filter((j) => j.kind === "dream");
    assert.ok(
      after.some((j) => /more of \d+ notes today/.test(String(j.result))),
      JSON.stringify(after),
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
