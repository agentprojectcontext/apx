import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { buttonId, parseButton } from "../channels/notices.ts";
import { openDb } from "../db/db.ts";
import type { Presentation } from "../domain/channels.ts";
import { seed } from "../domain/seed.ts";
import { createStore, type Store } from "../domain/store.ts";
import { say, scriptedLlm } from "../engine/testkit.ts";
import type { Log } from "../log.ts";
import { NEWS, type NewsEntry, newsAction } from "./entries.ts";
import { createNews } from "./news.ts";

const quiet: Log = { info: () => {}, warn: () => {}, error: () => {} };

function setup(o: { entries?: readonly NewsEntry[]; models?: string[]; fail?: boolean; noGoogle?: boolean } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-news-"));
  const db = openDb(home);
  const store = createStore(db, createBus());
  seed(store, "Roby");
  // Calendar connected: the tests below are about widget news; Google's have one of their own.
  if (!o.noGoogle) store.settings.set("google_account:google-calendar", "owner@example.com");
  const llm = scriptedLlm(() => {
    if (o.fail) throw new Error("provider down");
    return say("¡Hola! Tus widgets ahora recuerdan su última lectura.");
  });
  const notices: Array<{ body: Presentation; thread: string }> = [];
  const news = createNews({
    store,
    llm,
    models: () => o.models ?? ["fake/fake-1"],
    notifyOwner: (body, thread) => {
      notices.push({ body, thread });
      return true;
    },
    log: quiet,
    ...(o.entries ? { entries: o.entries } : {}),
  });
  const done = () => {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  };
  return { store, llm, news, notices, done };
}

const ownerWrote = (store: Store) =>
  store.messages.add({ thread_id: "home", author: { kind: "user" }, parts: [{ type: "text", text: "hola" }] });
const aWidget = (store: Store, name = "weather") =>
  store.surfaces.upsert({ name, title: "Weather", html: "<p>sunny</p>", created_by: "roby" });

const entry = (id: string, since = "2.7.3"): NewsEntry => ({
  id,
  since,
  title: id,
  applies: () => true,
  text: `What ${id} brings.`,
  actions: [
    { label: { en: `Do ${id}`, es: `Hacer ${id}` }, prompt: `Please do ${id}.` },
    { label: { en: `Other ${id}`, es: `Otro ${id}` }, prompt: `Other ${id}.` },
  ],
});

test("a fresh install knows every entry and is told none, with no model call", async () => {
  const { store, llm, news, notices, done } = setup();
  try {
    aWidget(store);
    const r = await news.atBoot();
    assert.deepEqual(r.told, []);
    assert.equal(llm.calls.length, 0);
    assert.equal(notices.length, 0);
    assert.ok(news.list().every((e) => e.seen));
    ownerWrote(store);
    await news.atBoot();
    assert.equal(llm.calls.length, 0, "known from the start: never told later");
  } finally {
    done();
  }
});

test("an upgrade with nothing that applies sends nothing to the model", async () => {
  const { store, llm, news, notices, done } = setup();
  try {
    ownerWrote(store);
    const r = await news.atBoot("2.7.2");
    assert.deepEqual(r.told, []);
    assert.equal(llm.calls.length, 0, "no widgets: the kit's news does not apply");
    assert.equal(notices.length, 0);
    const kit = news.list().find((e) => e.id === "artifacts-kit");
    assert.equal(kit?.seen, false, "kept for when it applies");
    assert.equal(kit?.applies, false);
  } finally {
    done();
  }
});

test("an upgrade with one entry that applies runs one capped, toolless call and tells it once", async () => {
  const { store, llm, news, notices, done } = setup();
  try {
    ownerWrote(store);
    aWidget(store);
    const r = await news.atBoot("2.7.2");
    assert.deepEqual(r.told, ["artifacts-kit"]);
    assert.equal(r.voiced, true);
    assert.equal(llm.calls.length, 1);
    const call = llm.calls[0];
    assert.deepEqual(call?.tools, [], "no tools");
    assert.ok(call?.maxOutputTokens && call.maxOutputTokens <= 500, "a small output cap");
    const input = String(call?.messages.at(-1)?.content);
    assert.ok(input.length < 900, `a compact input (${input.length} chars)`);
    assert.match(input, /remember their last reading/);
    assert.match(input, /their language \(es\)/);
    assert.match(String(call?.messages[0]?.content), /You are Roby/);

    assert.equal(notices.length, 1);
    const [notice] = notices;
    assert.equal(notice?.thread, "home");
    assert.match(notice?.body.text ?? "", /widgets ahora recuerdan/);
    assert.deepEqual(
      notice?.body.buttons?.map((b) => b.label),
      ["Actualizar mis widgets", "Convertir uno en app"],
      "one entry: its own actions, in the owner's language",
    );
    const home = store.threads.get("home");
    assert.equal(home?.unread, 1);
    assert.ok(store.messages.list("home", 10).some((m) => m.author.kind === "agent"));

    assert.ok(news.list().find((e) => e.id === "artifacts-kit")?.seen, "seen once delivered");
    await news.atBoot("2.7.3");
    assert.equal(llm.calls.length, 1, "told once");
  } finally {
    done();
  }
});

test("a failed model call marks nothing seen: the next start tries again", async () => {
  const failing = setup({ fail: true });
  try {
    ownerWrote(failing.store);
    aWidget(failing.store);
    await assert.rejects(failing.news.atBoot("2.7.2"), /provider down/);
    assert.equal(failing.notices.length, 0);
    assert.equal(failing.news.list().find((e) => e.id === "artifacts-kit")?.seen, false);
  } finally {
    failing.done();
  }
});

test("several entries: one action each, at most three, and the rest counted in the message", async () => {
  const entries = ["a", "b", "c", "d", "e"].map((id) => entry(id));
  const { store, llm, news, notices, done } = setup({ entries });
  try {
    ownerWrote(store);
    const r = await news.atBoot();
    assert.deepEqual(r.told, ["a", "b", "c", "d", "e"]);
    assert.equal(llm.calls.length, 1, "one message for all of them");
    assert.deepEqual(
      notices[0]?.body.buttons?.map((b) => b.label),
      ["Hacer a", "Hacer b", "Hacer c"],
    );
    assert.match(String(llm.calls[0]?.messages.at(-1)?.content), /there are 2 more things/);
  } finally {
    done();
  }
});

test("news from a release the install was already on when news began are known, not told", async () => {
  const entries = [entry("old", "2.7.0"), entry("new", "2.7.3")];
  const { store, news, done } = setup({ entries });
  try {
    ownerWrote(store);
    const r = await news.atBoot("2.7.2");
    assert.deepEqual(r.told, ["new"]);
    assert.ok(news.list().every((e) => e.seen));
  } finally {
    done();
  }
});

test("without an API model the entries go out as they are, in English", async () => {
  const { store, llm, news, notices, done } = setup({ models: [] });
  try {
    ownerWrote(store);
    aWidget(store);
    const r = await news.atBoot("2.7.2");
    assert.equal(r.voiced, false);
    assert.equal(llm.calls.length, 0);
    assert.match(notices[0]?.body.text ?? "", /^APX has something new for you/);
    assert.match(notices[0]?.body.text ?? "", /Update my widgets, or Make one an app/);
  } finally {
    done();
  }
});

test("a replay tells the given entry again; an unknown id is refused", async () => {
  const { store, llm, news, done } = setup();
  try {
    ownerWrote(store);
    await news.atBoot();
    const r = await news.tell(["artifacts-kit"]);
    assert.deepEqual(r.told, ["artifacts-kit"], "told even though no widget makes it apply");
    assert.equal(llm.calls.length, 1);
    await assert.rejects(news.tell(["nope"]), /no such news: nope/);
  } finally {
    done();
  }
});

test("a channel button carries the entry and action, and fits Telegram's 64 bytes", () => {
  for (const e of NEWS)
    e.actions.forEach((a, i) => {
      const id = buttonId.news(e.id, i);
      assert.ok(Buffer.byteLength(id) <= 64, id);
      const b = parseButton(id);
      assert.deepEqual(b, { kind: "news", entry: e.id, index: i });
      assert.equal(newsAction(e.id, i)?.prompt, a.prompt);
    });
  assert.equal(newsAction("artifacts-kit", 9), undefined);
});

test("Google news reach an owner without Calendar; mail alerts only a secretary owner who can read Gmail", () => {
  const { store, news, done } = setup({ noGoogle: true });
  try {
    const applies = (id: string) => news.list().find((n) => n.id === id)?.applies;
    assert.equal(applies("google"), true, "nothing connected yet");
    assert.equal(applies("mail-alerts"), false);

    store.settings.set("google_account:google-calendar", "owner@example.com");
    assert.equal(applies("google"), false, "Calendar already connected: nothing to tell");

    store.settings.set("google_account:gmail", "owner@example.com");
    store.settings.set("google_client:gmail", "apx");
    store.settings.write("profile", { id: "secretary", values: {} });
    assert.equal(applies("mail-alerts"), false, "APX's sign-in only sends mail");
    store.settings.set("google_client:gmail", "own");
    assert.equal(applies("mail-alerts"), true);
    store.settings.write("profile", { id: null, values: {} });
    assert.equal(applies("mail-alerts"), false, "without the secretary nobody reads mail");
  } finally {
    done();
  }
});
