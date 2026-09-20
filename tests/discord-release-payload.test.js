// The release announcement Discord actually receives.
//
// This runs once per release, unattended, and its failures are silent: Discord
// rejects an oversized embed with a 400 and the release simply goes unannounced.
// So the limits are the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload } from "../scripts/discord-release-payload.js";

const REPO = "agentprojectcontext/apx";
const notes = (body) => `# [9.9.9](https://github.com/${REPO}/compare/v9.9.8...v9.9.9) (2026-09-19)\n\n${body}`;

test("the notes become sections, and the commit links survive", () => {
  const p = buildPayload("9.9.9", REPO, notes(
    "### Bug Fixes\n\n" +
    `* **web:** una cosa ([abc1234](https://github.com/${REPO}/commit/abc1234def5678))\n\n` +
    "### Features\n\n" +
    `* **cli:** otra cosa ([9876543](https://github.com/${REPO}/commit/9876543abcdef0))\n`,
  ));
  const e = p.embeds[0];
  // The username already says APX; the title carries the version and its type.
  assert.equal(e.title, "🚀 v9.9.9");
  assert.equal(e.url, `https://github.com/${REPO}/releases/tag/v9.9.9`);
  assert.deepEqual(e.fields.map((f) => f.name), ["Bug Fixes", "Features"]);
  assert.match(e.fields[0].value, /• \*\*web:\*\* una cosa/);
  // The link stays clickable; only its TEXT is shortened to the 7-char sha the
  // notes already show — the url keeps the full one.
  assert.match(e.fields[0].value, /\[`abc1234`\]\(https:\/\/github\.com\/.*?\/commit\/abc1234def5678\)/);
  // The version heading is not a section: it would arrive as an empty field,
  // which Discord rejects.
  assert.ok(!e.fields.some((f) => /9\.9\.9/.test(f.name)));
});

test("an overlong section is cut, and says how many it is hiding", () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    `* **scope${i}:** ${"texto largo ".repeat(6)}([abc${String(i).padStart(4, "0")}](https://github.com/${REPO}/commit/abc${i}))`,
  ).join("\n");
  const e = buildPayload("9.9.9", REPO, notes(`### Bug Fixes\n\n${many}\n`)).embeds[0];
  const field = e.fields[0];

  // Discord's hard limits.
  assert.ok(field.value.length <= 1024, `field is ${field.value.length} chars`);
  assert.ok(JSON.stringify(e).length < 6000);
  assert.ok(e.fields.length <= 25);

  // And the tail is the TRUTH: shown + hidden = what there was. Counting the
  // remainder of an already-capped list announced "…y 5 más" over a section
  // that was holding back eighteen.
  const shown = field.value.split("\n").filter((l) => l.startsWith("•")).length;
  const tail = field.value.split("\n").pop();
  const hidden = Number(tail.match(/…y (\d+) más/)[1]);
  assert.equal(shown + hidden, 40);
});

test("the message says what kind of release it is, and who wrote it", () => {
  const body = "### Features\n\n* **web:** algo ([abc1234](https://x/commit/abc1234))\n";

  // A patch and a minor have to be told apart at a glance: now that every
  // release is announced, most weeks the channel is patches, and a minor should
  // not have to be read to be noticed.
  assert.match(buildPayload("1.2.4", REPO, notes(body), { previous: "1.2.3" }).embeds[0].title, /^🔧 v1\.2\.4$/);
  assert.match(buildPayload("1.3.0", REPO, notes(body), { previous: "1.2.3" }).embeds[0].title, /^🚀 v1\.3\.0$/);
  // No previous version to compare against: never claim it is a patch.
  assert.match(buildPayload("1.3.0", REPO, notes(body)).embeds[0].title, /^🚀/);

  // A line OUTSIDE the embed, because that is what a notification and the
  // channel sidebar show — an embed title appears in neither.
  assert.equal(buildPayload("1.3.0", REPO, notes(body)).content, "**APX** v1.3.0");
  assert.match(buildPayload("1.3.0", REPO, notes(body), { roleId: "42" }).content, /^<@&42> /);

  // Credits, minus the machine: semantic-release authors the version commit of
  // every release, so thanking it thanks the thing that posted the message.
  const credited = buildPayload("1.3.0", REPO, notes(body), {
    credits: ["tecnomanu", "semantic-release-bot", "dependabot[bot]", "otro"],
  }).embeds[0].fields.find((f) => f.name === "Credits");
  assert.match(credited.value, /\[@tecnomanu\]\(https:\/\/github\.com\/tecnomanu\)/);
  assert.match(credited.value, / y \[@otro\]/);
  assert.doesNotMatch(credited.value, /bot/);

  // Nobody left to thank → no empty field, which Discord rejects.
  assert.ok(!buildPayload("1.3.0", REPO, notes(body), { credits: ["semantic-release-bot"] })
    .embeds[0].fields.some((f) => f.name === "Credits"));
});

test("the buttons are links, so nothing has to be listening for them", () => {
  const p = buildPayload("1.3.0", REPO, notes("### Features\n\n* algo\n"));
  const row = p.components[0];
  assert.equal(row.type, 1);
  for (const b of row.components) {
    assert.equal(b.type, 2);
    // Style 5 is a link. Any other style carries a custom_id and needs an
    // application to answer the click — there is none here, so the button
    // would spin and fail.
    assert.equal(b.style, 5);
    assert.match(b.url, /^https:\/\/github\.com\//);
    assert.equal(b.custom_id, undefined);
  }
});

test("notes that could not be read still produce a valid announcement", () => {
  const e = buildPayload("9.9.9", REPO, "").embeds[0];
  // No `fields` key at all — an empty array is a 400, and a release that
  // happened is worth saying even when the notes are not available.
  assert.equal(e.fields, undefined);
  assert.match(e.description, /npm install -g @agentprojectcontext\/apx/);
  assert.match(e.description, /\[Changelog\]/);
});
