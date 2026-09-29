// Keep the owner's mark on the Discord ledger in step with `owner_ids`.
//
// A row is drawn on the owner's side of the thread when `meta.owner` is true,
// and that mark is written as the message arrives. Two cases leave it wrong:
// rows stored before the mark existed, and an owner id added (or removed)
// later. This pass rewrites the flag from `meta.discord_user_id` — a fact the
// row already records — so the panel matches the current list.
//
// It runs when the Discord plugin starts, BEFORE the connection opens: at that
// moment nothing else appends to these files, so a rewrite cannot race a new
// message. Sync I/O is right here for the same reason — it is boot, not a
// request path. Each file is written to a temp name and renamed, so a crash
// mid-pass leaves the old file, never half of one.
import fs from "node:fs";
import path from "node:path";
import { GLOBAL_MESSAGES_DIR } from "#core/config/index.js";
import { CHANNELS } from "#core/constants/channels.js";

export function markOwnerRows(ownerIds = [], { messagesDir = GLOBAL_MESSAGES_DIR } = {}) {
  const dir = path.join(messagesDir, CHANNELS.DISCORD);
  if (!fs.existsSync(dir)) return 0;
  const owners = new Set(ownerIds.map(String));
  let changed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
    const file = path.join(dir, f);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let dirty = false;
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      let row;
      try { row = JSON.parse(line); } catch { return line; }
      const uid = row?.meta?.discord_user_id;
      if (row?.direction !== "in" || !uid) return line;
      const should = owners.has(String(uid));
      if (should === (row.meta.owner === true)) return line;
      if (should) row.meta.owner = true;
      else delete row.meta.owner;
      dirty = true;
      changed += 1;
      return JSON.stringify(row);
    });
    if (!dirty) continue;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, out.join("\n"));
    fs.renameSync(tmp, file);
  }
  return changed;
}
