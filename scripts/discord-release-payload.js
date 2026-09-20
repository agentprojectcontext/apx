#!/usr/bin/env node
// Turns semantic-release's release notes into a Discord webhook payload.
//
// The announcement used to be four words and a link to CHANGELOG.md, which
// meant the only way to find out what landed was to leave Discord. The notes
// already exist and already say it — this reshapes them into an embed so the
// message itself is the answer.
//
//   node scripts/discord-release-payload.js <version> <owner/repo> < notes.md
//
// A real BUTTON (the pill that release bots show) is not available here: Discord
// only accepts message components from an application-owned webhook, and a plain
// channel webhook cannot send them. The links are ordinary markdown, which is
// the whole of what a webhook gets.
//
// Discord's limits are hard failures, not truncations — the POST is rejected
// with a 400 and the release goes unannounced — so every one of them is capped
// here: 1024 characters per field, 25 fields, 6000 characters over the embed.

import { pathToFileURL } from "node:url";

const FIELD_MAX = 1024;
const EMBED_MAX = 5800; // 6000, with room for the title and description
const MAX_FIELDS = 10;
const BULLETS_PER_SECTION = 10;
const BRAND = 4176208; // APX green

/** `* **scope:** text ([hash](url))` → a tighter line that reads as a sentence. */
function tidyBullet(line) {
  const body = line.replace(/^\s*[*-]\s+/, "").trim();
  // Shorten the 40-character commit sha the generator writes into the link
  // text; the url keeps the full one.
  return "• " + body.replace(/\[([0-9a-f]{7})[0-9a-f]*\]/g, "[`$1`]");
}

/**
 * Cut a list of lines to fit a field, and say how many were dropped rather than
 * ending mid-sentence — a list that stops without warning reads as the whole
 * list.
 *
 * It is handed the WHOLE list, never a pre-sliced one, because the count in the
 * tail has to be the truth: capping at ten first and then counting what was
 * dropped from those ten announced "…y 5 más" over a section that was hiding
 * fifteen.
 */
function fitLines(lines, extra) {
  const limit = Math.min(FIELD_MAX, extra);
  const out = [];
  let used = 0;
  for (const line of lines) {
    if (out.length >= BULLETS_PER_SECTION) break;
    const more = lines.length - out.length;
    // Reserve room for the "…y N más" line before deciding this one fits.
    const tail = more > 1 ? `\n…y ${more} más`.length : 0;
    if (used + line.length + 1 + tail > limit) break;
    out.push(line);
    used += line.length + 1;
  }
  const dropped = lines.length - out.length;
  if (dropped > 0) out.push(`…y ${dropped} más`);
  return out.join("\n");
}

export function buildPayload(version, repo, notes) {
  const release = `https://github.com/${repo}/releases/tag/v${version}`;
  const sections = [];
  let current = null;
  for (const raw of String(notes || "").split("\n")) {
    const heading = raw.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      current = { name: heading[1].replace(/\[|\]\(.*?\)/g, "").trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (/^\s*[*-]\s+\S/.test(raw) && current) current.lines.push(tidyBullet(raw));
  }

  let budget = EMBED_MAX;
  const fields = [];
  for (const section of sections) {
    if (!section.lines.length || fields.length >= MAX_FIELDS) continue;
    const value = fitLines(section.lines, budget);
    if (!value) continue;
    budget -= value.length + section.name.length;
    fields.push({ name: section.name, value });
    if (budget <= 0) break;
  }

  return {
    username: "APX",
    embeds: [
      {
        title: `APX v${version}`,
        url: release,
        color: BRAND,
        description:
          "`npm install -g @agentprojectcontext/apx`\n" +
          `[Changelog](https://github.com/${repo}/blob/main/CHANGELOG.md) · [Release](${release})`,
        // Nothing to show when the notes could not be read — an embed with a
        // title and an install line is still a correct announcement.
        ...(fields.length ? { fields } : {}),
      },
    ],
  };
}

// Run as a command: notes on stdin, payload on stdout. Imported by the test,
// which must not trigger any of this.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , version, repo] = process.argv;
  const notes = await new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    if (process.stdin.isTTY) resolve("");
  });
  process.stdout.write(JSON.stringify(buildPayload(version, repo, notes)));
}
