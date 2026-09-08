// "Who you're talking to", WhatsApp edition.
//
// The generic buildRelationshipBlock (prompt-builder.js) knows a name, a handle
// and a role — enough for Telegram, where the roster is a permission list. Here
// the roster is also a description of a PERSON, because the turn that reads it
// has almost nothing else: no memory, no history beyond this one thread, no
// tools. What the owner wrote about this contact is very nearly the whole of
// what the agent knows.
//
// So this block carries four owner-written fields, and their order is the point:
// who they are, then what the owner wants done. Rules last, because recency
// wins in a system prompt and the rules are the part that must not be talked
// out of.
import { findWhatsAppContact } from "../../identity/whatsapp.js";
import { relationshipPhrase } from "./relationships.js";
import { resolveCapabilities, resolveFacts } from "./config.js";

/**
 * @param {object} sender  from resolveWhatsAppSender
 * @param {object} cfg     global config (for the roster entry)
 */
export function buildWhatsAppRelationshipBlock(sender, cfg) {
  if (!sender || !sender.jid) return "";
  const c = findWhatsAppContact(cfg, sender.jid) || {};
  const lines = ["# Who you're talking to"];

  if (sender.isOwner) {
    lines.push(`You are talking to your owner, ${c.name || sender.name}. Never ask who they are.`);
    return lines.join("\n");
  }

  if (sender.isGroup) {
    lines.push(
      "This is a WhatsApp GROUP: several people read everything you write here, " +
      "not only the person who sent this message."
    );
  }

  const name = c.name || sender.name || "someone";
  const called = c.nickname ? ` — everyone calls them ${c.nickname}` : "";
  lines.push(`You are talking to ${name}${called}.`);
  const rel = relationshipPhrase(c.relationship);
  if (rel) lines.push(`Their relationship to your owner: ${rel}.`);
  if (c.bio) lines.push(`About them: ${c.bio}`);
  if (c.note) lines.push(`Note: ${c.note}`);

  if (c.rules) {
    lines.push("");
    lines.push("## What your owner has told you about this person");
    lines.push(c.rules);
    lines.push("");
    // The owner can widen the latitude here — "answer her about anything" — but
    // widening is bounded by what this turn HAS, which is nothing: no tools, no
    // memory, no other conversation. So a generous rule can only make the tone
    // warmer and the hedging lighter; it cannot produce information that was
    // never in the context. Saying so stops the model reading a warm rule as
    // permission to invent the details it would need to honour it.
    lines.push(
      "That is your owner speaking, and it outranks your own caution about how much to say to THIS person. " +
      "It does not give you facts you do not have: if the answer is not in this conversation, you still do not know it, " +
      "however freely you have been told to speak."
    );
  }

  const caps = resolveCapabilities(cfg, c);
  const facts = caps.facts ? resolveFacts(cfg, c) : "";

  if (facts) {
    lines.push("");
    lines.push("## What you may answer directly");
    lines.push(
      "Your owner wrote the following for this person. You may answer from it without checking with anyone — " +
      "it is already approved. Everything NOT in it is still something you do not know."
    );
    lines.push("");
    lines.push(facts);
  }

  if (caps.appointments || caps.errands) {
    lines.push("");
    lines.push("## When they ask for something");
    if (caps.appointments) {
      lines.push(
        "- A time, a date, a turn, an appointment: take the details naturally in the conversation — what for, " +
        "and when suits them — and tell them you are passing it on for confirmation. You are NOT confirming it. " +
        "Never name a time as agreed, never say it is booked, and never offer a slot as if it were free."
      );
    }
    if (caps.errands) {
      lines.push(
        "- Anything else they need: make sure you have understood WHAT they want and how urgent it is, ask if " +
        "it is unclear, then say you are passing it on."
      );
    }
    lines.push(
      "Nothing about this changes what you say next: your owner is told automatically, so do not promise to " +
      "arrange it, do not promise when, and do not send a second message about it."
    );
  }

  return lines.join("\n");
}
