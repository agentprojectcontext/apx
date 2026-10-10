import assert from "node:assert/strict";
import { test } from "node:test";
import { org, owner, ownerPatchOf, profiles } from "./owner.ts";
import { printed, recordingClient } from "./testing.ts";

const me = { name: "Alex", about: "Runs Acme.", language: "en", timezone: "" };

test("owner prints who you are; set sends only the identity's keys", async () => {
  const { client, calls } = recordingClient({ "owner.get": me, "owner.set": { ...me, timezone: "Europe/Madrid" } });
  const out = await printed(() => owner(client, []));
  assert.match(out, /^Name: +Alex\nLanguage: +en\nTime zone: +this machine's\n\nRuns Acme\.$/);
  assert.match(await printed(() => owner(client, ["set", "timezone=Europe/Madrid"])), /Time zone: +Europe\/Madrid/);
  assert.deepEqual(calls, [
    ["owner.get", {}],
    ["owner.set", { timezone: "Europe/Madrid" }],
  ]);
  assert.deepEqual(ownerPatchOf(["about=a=b", "name="]), { about: "a=b", name: "" });
  assert.throws(() => ownerPatchOf(["phone=1"]), /unknown: phone/);
  assert.throws(() => ownerPatchOf([]), /apx owner set/);
  assert.throws(() => ownerPatchOf(["name"]), /expected key=value/);
});

const organization = {
  areas: [{ slug: "finance", name: "Finance", goal: "Cash in order" }],
  roles: [
    { slug: "cfo", name: "Chief Financial Officer", area: "finance" },
    { slug: "assistant", name: "Assistant" },
  ],
};

test("org lists roles by area; set reads the organization from stdin for the project", async () => {
  const { client, calls } = recordingClient({ "org.get": organization, "org.set": organization });
  const out = await printed(() => org(client, [], {}));
  assert.match(
    out,
    /Finance \(finance\) {2}· Cash in order\n {2}cfo +Chief Financial Officer\n\nGeneral\n {2}assistant/,
  );
  await printed(() => org(client, ["set"], { project: "prj_1" }, async () => JSON.stringify(organization)));
  assert.deepEqual(calls, [
    ["org.get", {}],
    ["org.set", { project: "prj_1", organization }],
  ]);
});

const field = (key: string, type: string, def: string | number) => ({ key, type, label: { en: key }, default: def });
const secretary = {
  id: "secretary",
  name: { en: "Secretary" },
  description: { en: "" },
  source: "apx",
  settings: [field("day_open", "schedule", "0 9 * * 1-5"), field("waiting_hours", "number", 24)],
  routines: [],
};
const routine = { id: "rtn_1", name: "Day open", enabled: true };
const listed = {
  profiles: [secretary, { ...secretary, id: "focus", name: { en: "Focus coach" }, settings: [], source: "owner" }],
  active: { id: "secretary", values: { day_open: "0 8 * * 1-5" } },
  routines: [routine],
};

test("profiles lists each profile's settings, the running one's values and its routines", async () => {
  const { client } = recordingClient({ "profiles.list": listed });
  const out = await printed(() => profiles(client, []));
  assert.match(
    out,
    /^\* secretary +Secretary\n {4}day_open +0 8 \* \* 1-5\n {4}waiting_hours +24\n {2}focus +Focus coach {2}· installed/,
  );
  assert.match(out, /Routines it keeps\n {2}rtn_1 {2}Day open/);
});

test("profiles use keeps the running profile's values, adds the given ones and refuses unknown settings", async () => {
  const { client, calls } = recordingClient({
    "profiles.list": listed,
    "profiles.set": { active: listed.active, routines: [routine] },
  });
  assert.match(await printed(() => profiles(client, ["use", "secretary", "waiting_hours=12"])), /Secretary runs · 1/);
  await profiles(client, ["use", "focus"]);
  assert.deepEqual(
    calls.filter(([m]) => m === "profiles.set"),
    [
      ["profiles.set", { id: "secretary", values: { day_open: "0 8 * * 1-5", waiting_hours: 12 } }],
      ["profiles.set", { id: "focus", values: {} }],
    ],
  );
  await assert.rejects(profiles(client, ["use", "secretary", "color=red"]), /no setting color \(it has: day_open/);
  await assert.rejects(profiles(client, ["use", "nope"]), /no profile nope/);
});

test("profiles off runs none, restore puts back a routine's prompt, help calls nothing", async () => {
  const { client, calls } = recordingClient({
    "profiles.set": { active: { id: null, values: {} }, routines: [] },
    "profiles.restore": routine,
  });
  await printed(() => profiles(client, ["off"]));
  assert.match(
    await printed(() => profiles(client, ["restore", "rtn_1"])),
    /rtn_1 {2}Day open: default prompt restored/,
  );
  assert.match(await printed(() => profiles(client, ["help"])), /apx profiles use <id>/);
  assert.match(await printed(() => owner(client, ["help"])), /^apx owner/);
  assert.match(await printed(() => org(client, ["help"], {})), /^apx org/);
  assert.deepEqual(calls, [
    ["profiles.set", { id: null, values: {} }],
    ["profiles.restore", { routine: "rtn_1" }],
  ]);
});
