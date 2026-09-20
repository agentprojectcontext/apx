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
  assert.equal(e.title, "APX v9.9.9");
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

test("notes that could not be read still produce a valid announcement", () => {
  const e = buildPayload("9.9.9", REPO, "").embeds[0];
  // No `fields` key at all — an empty array is a 400, and a release that
  // happened is worth saying even when the notes are not available.
  assert.equal(e.fields, undefined);
  assert.match(e.description, /npm install -g @agentprojectcontext\/apx/);
  assert.match(e.description, /\[Changelog\]/);
});
