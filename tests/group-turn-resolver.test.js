import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMentions,
  seedSpeakers,
  resolveGroupTurn,
} from "#core/agent/group/turn-resolver.js";

const PARTICIPANTS = [
  { slug: "owner", name: "Manu", kind: "owner" },
  { slug: "candela", name: "Candela", kind: "agent" },
  { slug: "naty", name: "Natalia", kind: "agent" },
];

test("parseMentions resolves slug and name, case/accent-insensitive", () => {
  assert.deepEqual(parseMentions("hola @naty", PARTICIPANTS, "owner"), ["naty"]);
  assert.deepEqual(parseMentions("che @Natalia", PARTICIPANTS, "owner"), ["naty"]);
  assert.deepEqual(parseMentions("@CANDELA y @naty", PARTICIPANTS, "owner"), ["candela", "naty"]);
});

test("parseMentions ignores the author and unknown handles", () => {
  assert.deepEqual(parseMentions("@candela me cito a mi @naty", PARTICIPANTS, "naty"), ["candela"]);
  assert.deepEqual(parseMentions("@nadie @roby", PARTICIPANTS, "owner"), []);
  assert.deepEqual(parseMentions("mail me@example.com", PARTICIPANTS, "owner"), []);
});

test("seedSpeakers falls back to the first agent when nobody is mentioned", () => {
  assert.deepEqual(seedSpeakers("hola gente", PARTICIPANTS), ["candela"]);
  assert.deepEqual(seedSpeakers("hola @naty", PARTICIPANTS), ["naty"]);
});

test("cascade: owner -> naty, naty tags candela, candela speaks", async () => {
  const order = [];
  const scripts = {
    naty: "de una, le pregunto a @candela",
    candela: "listo, ya está",
  };
  const replies = await resolveGroupTurn({
    text: "che @naty organizás algo con candela?",
    participants: PARTICIPANTS,
    onSpeakerStart: (s) => order.push(s),
    runAgent: async (slug) => scripts[slug],
  });
  assert.deepEqual(order, ["naty", "candela"]);
  assert.deepEqual(replies.map((r) => r.slug), ["naty", "candela"]);
});

test("no mention -> only the first agent speaks", async () => {
  const spoke = [];
  await resolveGroupTurn({
    text: "buenas",
    participants: PARTICIPANTS,
    runAgent: async (slug) => { spoke.push(slug); return "hola"; },
  });
  assert.deepEqual(spoke, ["candela"]);
});

test("A<->B ping-pong continues until they stop citing", async () => {
  const spoke = [];
  let n = 0;
  await resolveGroupTurn({
    text: "@naty",
    participants: PARTICIPANTS,
    runAgent: async (slug) => {
      spoke.push(slug);
      n += 1;
      if (n >= 4) return "listo, corto";
      return slug === "naty" ? "hey @candela" : "hey @naty";
    },
  });
  assert.deepEqual(spoke, ["naty", "candela", "naty", "candela"]);
});

test("A<->B ping-pong stops at the 10-message ceiling", async () => {
  const spoke = [];
  await resolveGroupTurn({
    text: "@naty",
    participants: PARTICIPANTS,
    runAgent: async (slug) => {
      spoke.push(slug);
      return slug === "naty" ? "hey @candela" : "hey @naty";
    },
  });
  assert.equal(spoke.length, 10);
  assert.deepEqual(spoke.slice(0, 4), ["naty", "candela", "naty", "candela"]);
});

test("resume starts from a later speaker; a new @mention pulls the earlier one back in", async () => {
  const spoke = [];
  await resolveGroupTurn({
    text: "hola",
    participants: PARTICIPANTS,
    resume: { from: "naty", reason: "candela", byOwner: false },
    runAgent: async (slug) => {
      spoke.push(slug);
      return slug === "naty" ? "hey @candela" : "ok, corto";
    },
  });
  assert.deepEqual(spoke, ["naty", "candela"]);
});

test("resume from the first speaker still cascades to new mentions", async () => {
  const spoke = [];
  await resolveGroupTurn({
    text: "hola",
    participants: PARTICIPANTS,
    resume: { from: "candela", reason: "owner", byOwner: true, spoken: [] },
    runAgent: async (slug) => {
      spoke.push(slug);
      return slug === "candela" ? "che @naty" : "ok";
    },
  });
  assert.deepEqual(spoke, ["candela", "naty"]);
});

test("runAgent receives who summoned it", async () => {
  const reasons = {};
  await resolveGroupTurn({
    text: "@naty",
    participants: PARTICIPANTS,
    runAgent: async (slug, ctx) => {
      reasons[slug] = ctx;
      return slug === "naty" ? "traigo a @candela" : "ok";
    },
  });
  assert.equal(reasons.naty.byOwner, true);
  assert.equal(reasons.naty.reason, "owner");
  assert.equal(reasons.candela.byOwner, false);
  assert.equal(reasons.candela.reason, "naty");
});
