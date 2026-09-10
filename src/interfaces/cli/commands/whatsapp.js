// apx whatsapp — look at the chats, and fix the ones that came out wrong.
//
// The panel owns the roster: names, roles, who may be answered. What it has no
// way to show is the state BETWEEN the roster and the ledger — a company with
// no name, a conversation APX opened and cannot continue, a message that was
// written down as "[empty message]" because the decoder of the day did not know
// the shape it arrived in. That is what these two commands are for: `chats`
// says what is wrong, `repair` fixes it.
//
// Adapter only. Everything it prints comes from one core call through the
// daemon (core/channels/whatsapp/repair.js) — the CLI decides nothing.
import { http } from "../http.js";

const dash = "—";

export async function cmdWhatsAppStatus() {
  const s = await http.get("/api/whatsapp/status");
  console.log(`state:        ${s.state}${s.error ? ` (${s.error})` : ""}`);
  console.log(`enabled:      ${s.enabled !== false}`);
  console.log(`auto_reply:   ${s.auto_reply !== false}`);
  console.log(`this line:    ${s.self_jid || dash}`);
  console.log(`owner:        ${s.owner_jid || dash}`);
  console.log(`contacts:     ${s.contacts ?? 0}`);
}

/**
 * What is wrong with the chats. Reads, changes nothing.
 *
 * Grouped by what the owner would DO about it rather than by contact, because
 * the answer is almost always the same for a whole group ("yes, fix all of it")
 * and reading it person by person buries that.
 */
export async function cmdWhatsAppChats() {
  const found = await http.get("/api/whatsapp/repair");
  const contacts = found.contacts || [];
  const messages = found.messages || [];

  if (!contacts.length && !messages.length) {
    console.log("✅ nothing to fix — every chat has a name, an owner decision and its messages");
    return;
  }

  for (const [kind, title] of [
    ["nameless", "No name on the roster"],
    ["unvouched", "APX wrote to them first and cannot answer them back"],
    ["alias", "Their other WhatsApp address is not linked"],
    ["duplicate", "Two rows for one person"],
  ]) {
    const rows = contacts.filter((c) => c.kind === kind);
    if (!rows.length) continue;
    console.log("");
    console.log(`${title} (${rows.length})`);
    for (const r of rows) console.log(`  ${r.name || r.jid}  ${dash} ${r.detail}`);
  }

  const unreadable = messages.filter((m) => m.kind === "unreadable");
  if (unreadable.length) {
    console.log("");
    console.log(`Arrived as an empty message (${unreadable.length})`);
    for (const m of unreadable) {
      console.log(`  ${m.ts}  ${m.jid}${m.attempts ? `  (asked ${m.attempts}×)` : ""}`);
    }
  }

  // Printed with the words, not just the address. This is the one finding the
  // owner may want to act on THEMSELVES — somebody is waiting — and deciding
  // that from a jid and a timestamp is impossible.
  const unanswered = messages.filter((m) => m.kind === "unanswered");
  if (unanswered.length) {
    console.log("");
    console.log(`Nobody answered them (${unanswered.length})`);
    for (const m of unanswered) {
      console.log(`  ${m.ts}  ${m.name || m.jid}`);
      console.log(`     ${m.text}`);
    }
  }

  console.log("");
  console.log("Fix it with: apx whatsapp repair   (add --dry-run to see it first)");
}

export async function cmdWhatsAppRepair(args) {
  const dry_run = args.flags["dry-run"] === true || args.flags.dry === true;
  const force = args.flags.force === true;
  if (!dry_run) console.log("Repairing the WhatsApp chats… asking the phone for anything unreadable, one at a time.");

  const r = await http.post("/api/whatsapp/repair", { dry_run, force });

  for (const f of r.fixed || []) console.log(`  ✅ ${f.name || f.jid}  ${dash} ${f.action}`);
  for (const l of r.left || []) console.log(`  ⏭  ${l.name || l.jid}  ${dash} ${l.why}`);

  if (!r.fixed?.length && !r.left?.length) {
    console.log("✅ nothing to fix");
    return;
  }
  console.log("");
  console.log(
    `${dry_run ? "Would fix" : "Fixed"} ${r.fixed?.length || 0}, left ${r.left?.length || 0}` +
    (r.connected ? "" : " (whatsapp is not connected — a message can only come back from the phone)")
  );
}
