---
name: apx-whatsapp
description: APX WhatsApp channel — one paired account, an allowlist roster, and a sealed turn for everyone who is not the owner. Load BEFORE adding a contact, changing who gets answered, sending a message, or explaining why somebody was not replied to.
---

# apx-whatsapp

One WhatsApp account, paired by QR, run by the daemon plugin `whatsapp`. Config lives at `~/.apx/config.json → whatsapp`; credentials at `~/.apx/whatsapp/auth/default/` (0700 — whoever holds that folder IS the account).

Not an integration. It used to sit in the per-project plugin catalog and was moved out: there is one account, and a WhatsApp Web session is a device singleton, so "WhatsApp for project X" cannot exist.

## The three outcomes

Every inbound message resolves to exactly one of these, decided by code **before** any model sees the message:

| Sender | What runs | What they get |
|---|---|---|
| the owner (the account that paired) | the full super-agent turn — tools, memory, projects | a normal reply |
| a contact on the roster with a role | a **sealed** turn: no tools, no memory, no other channel, only that one conversation as history | a short plain-text reply |
| anyone else | nothing runs | **silence** — logged, and the owner is told |

Silence is the designed outcome for a stranger, not a failure. Do not "fix" it by adding people to the roster on your own; that is the owner's decision.

## Writing to somebody puts them ON the roster

A send is a vouch. `send_whatsapp` to a number nobody has vouched for adds them as `role: contact` with `pending_review: true` — answerable, but flagged as never reviewed, because the owner said "write to them", not "here is who they are".

Without this APX could OPEN a conversation and not continue it: it introduced itself to a new collaborator, he answered within the minute, and the reply resolved as a stranger's and got silence. The roster was fed only by people writing IN, so the one thing the owner explicitly authorised — a message going out — taught it nothing.

Three cases are deliberately left alone: the **owner** (their thread is not a roster row), **groups** (one recipient is not consent from the rest), and anyone **already carrying a role** — including one the owner muted on purpose, which a send must never quietly undo. A **reaction** vouches for nobody either: it is a mark on a conversation that already exists.

## Managing the roster yourself — `whatsapp_contacts`

Do not tell the owner to go and click in Settings. This tool is the roster, and it is lazy — activate it with `discover_tools({ category: "messages" })`.

| action | what it does |
|---|---|
| `list` | everyone; `pending: true` for the rows APX added by writing and nobody reviewed |
| `find` | by name, nickname or a number typed any way a person types one |
| `save` | add or update: `role` to let APX answer them, `auto_reply: false` to mute, plus `name` / `relationship` / `bio` / `rules` |
| `forget` | off the allowlist — the conversation history stays |

Every row carries a resolved `status` (`answered` / `silent` / `owner`), so you never have to reconstruct the policy from the role, the mute, the role table and the master switch. Reading is free; `save` and `forget` stop for permission, because they are standing grants rather than one message.

`relationship` is a CATEGORY from a fixed list (partner, family, client, supplier, …), not a sentence — "mi contadora" is `supplier` plus a `bio`.

## The roster is the allowlist

```json
{
  "whatsapp": {
    "owner_jid": "5491155555555@s.whatsapp.net",   // set at pairing, do not hand-edit
    "auto_reply": true,          // master switch for non-owner replies
    "reply_to_groups": false,    // groups are off by default
    "contacts": [{
      "jid": "5491166666666@s.whatsapp.net",
      "name": "Margarita",
      "nickname": "Magui",
      "relationship": "my wife",
      "bio": "who they are, in the owner's words",
      "rules": "what the owner wants done with this person",
      "role": "contact",         // guest = never answered
      "auto_reply": true
    }],
    "roles": { "cliente": { "auto_reply": true } }
  }
}
```

- A person who writes is recorded automatically as **guest**, which is not permission — a guest is still never answered. Recording exists so the owner has something to click "allow" on.
- `role: "owner"` cannot be granted from the roster. The owner is whoever paired.
- An undefined role fails closed (silence), so a typo never widens access.
- `bio` and `rules` reach ONLY the turn that answers that person. What is written about one contact is never in the prompt that answers another.

## API

All under `/api/whatsapp`. The panel is Settings → WhatsApp.

```
GET    /status                       session + roster summary
POST   /pair                         start pairing → { qr, qr_data_url }   ← the ONLY place a QR is returned
POST   /logout                       drop the credentials
PATCH  /settings                     { enabled, auto_reply, reply_to_groups }
POST   /send      { jid, text }
GET    /contacts                     PATCH/DELETE /contacts/:jid
GET    /roles                        PUT/DELETE /roles/:name
GET    /stickers                     PATCH /stickers/:key { meaning }
```

`GET /status` deliberately does not carry the QR: a QR is a live credential and whoever scans it owns the account, so it is handed out on an explicit request rather than swept up by a polling panel.

## Sending

Use the `send_whatsapp` tool: `{ to, text }`. `to` takes a phone number in any format or a full JID. Plain text only — WhatsApp renders no markdown, so asterisks and backticks arrive as literal characters.

It is delivered the instant the call returns. There is no draft, no undo, and no recall. Send when the owner asks you to write to someone; never on your own initiative, and never to "check" something with a third party.

**Every send is recorded, whichever door it came through.** The tool, `POST /send` from the panel, and the channel's own auto-reply all go through one function (`core/channels/whatsapp/outbox.js`) that sends and writes the ledger row in the same call, so a message you sent is in the thread, the panel and `tail_messages` the moment the tool returns. The result carries `message_id` and `logged: true`.

This was not always so, and the failure it caused is worth knowing about, because it is the kind you cannot see from inside a turn: the tool used to send without recording, so a message that HAD been delivered left no outgoing row. A peer agent read the ledger, correctly found nothing, told the super-agent it had lied about sending, and a duplicate went to the same person a minute later. If you are ever accused of not having sent something, the ledger is now authoritative — check it (`tail_messages`, channel `whatsapp`) before re-sending, because sending twice is not a free retry: it lands on somebody's phone twice.

Messages the OWNER types on their own phone are recorded too (WhatsApp mirrors them to us as `fromMe`). They are logged and never answered — replying would be answering yourself — and they carry `meta.authored_by: "owner"`, so a thread reads as the whole conversation rather than only the half APX wrote.

One person can hold two addresses — a phone JID and an opaque `…@lid`. Both fold to one thread; do not treat them as two correspondents.

A `…@lid` is WhatsApp's own opaque addressing, not a bug and not something APX chose: **the phone number is not in it and cannot be recovered from it.** Businesses always arrive this way, and increasingly so does everyone else. A verified business also sends its name as `verifiedBizName` rather than `pushName`, so the roster row records that plus `business: true` — before that was read, every company sat on the roster nameless and the panel printed the raw LID as the thread title.

## Menus, buttons and lists

A business account rarely writes sentences — it sends a MENU. Those arrive already unpacked into the text, numbered:

```
Hola! Con qué te ayudo?
[Opciones: 1. Autos | 2. Hogar | 3. Vida]
```

and a tap somebody made on one reads as `[eligió: Autos]`. All four generations WhatsApp still has in the wild are decoded — quick-reply buttons, lists, hydrated templates and nativeFlow (including a `single_select` list hidden inside one button, and carousels) — plus polls, and all of them wrapped in `viewOnceMessage` or `ephemeralMessage`, which is how business accounts usually send them.

Until this existed those messages had no readable text at all and were logged as `[empty message]`: a bot's whole menu reached the owner as a notification saying nothing had been said.

**To answer one, pass `option` to `send_whatsapp`** — the number as it was shown (`"2"`), the exact title (`"Autos"`) or the option's id. APX finds the last menu in that chat (off the ledger, so it survives a restart and a turn that never saw the message) and sends the real selection, so the bot sees its button pressed rather than a sentence. `text` is ignored when `option` is set.

The menu is found by PERSON, not by address: a company's menu usually arrives on their `@lid` while the number you wrote to is their `@s.whatsapp.net`, and matching the raw address found nothing — so the choice left as typed text and the bot answered "no te entendí". Ask about either address and you get the same menu, and the tap is sent back into the chat that showed it.

- An ambiguous fragment matches nothing on purpose. `"seguro"` against *Seguro de auto* and *Seguro de hogar* is refused, with both options in the answer, rather than tapping one on a guess.
- Quick-reply buttons, lists and templates are answered with a real tap. **nativeFlow menus and polls are answered by typing the option's label** — Baileys has no builder for `interactiveResponseMessage`, and inventing a proto it cannot encode would put a malformed node on somebody's server. This is not a downgrade in practice: typing the label is what a person does when a button will not open.
- If a tap goes unanswered, retry with `as_text: true` to type the label instead.

The thread records the LABEL (`Autos`), not the button id — a transcript full of opaque ids is not the conversation that happened.

## Media

Inbound is handled before the turn: voice notes arrive transcribed as `[audio] …`, photos as pixels a vision model can see, stickers as `[sticker: <meaning>]`, GIFs as their first frame. **Video is refused** — say so plainly rather than guessing from the caption.

**To SEND a file, pass `file` to `send_whatsapp`** — an absolute path on this machine. A document keeps its own name and arrives with a download button; an image arrives as a picture. `text` rides along as the caption. A file somebody sent you is already on disk: its path is `local_path` on that message's row.

**Files are kept, read where we can, and refused where we should.** A PDF or a text-ish file (txt, md, csv, json, xml, yaml, log…) arrives with its words in the turn — `[file: presupuesto.pdf, 64 KB]` followed by the contents, fenced, because a file's text is somebody else's words arriving through an attachment and not the message body. Anything else (docx, xlsx, zip…) is saved with its own name and offered in the panel; say what arrived rather than guessing what is in it. Programs and scripts (`.exe .msi .sh .apk .dmg .ps1 .jar` …, matched on the LAST extension, so `quote.pdf.exe` is an exe) are **never downloaded**, and neither is anything over 25 MB — the marker says which of the two it was. Archives are kept and never opened.

Stickers are learned once: the first sighting is described by a vision model and stored by content hash in `~/.apx/whatsapp/stickers.json`; every later sighting reuses those words. The owner can overwrite the wording and the model will never overwrite it back.

## Why the owner is always told, and only sometimes

The report to the owner is emitted by the daemon, not by the model — a sealed turn has no tools and could not escalate even if it wanted to. It is coalesced per correspondent (6 h for someone off the roster, 15 min for a real conversation), because the report is reactive and therefore does not spend the interruption budget: without its own limit, one stranger sending a hundred messages would be a hundred notifications.

So: do not tell a WhatsApp contact that you will "escalate" or "pass this to my owner and come back" as if you were arranging it. It already happened.

## The pause before an answer

A reply waits `whatsapp.reply_delay_ms` (2500 ms; 0 answers at once) and the newest message in a chat
wins: if another one arrives while the timer runs, the earlier turn stands down and the later one
answers both — the thread it reads holds everything said in between. People write in bursts, and an
answer that lands in under a second answers a third of a thought. Do not work around it by sending a
second message; the wait is per chat, and the typing indicator is on throughout.

## Repairing chats that came out wrong — `apx whatsapp`

Some failures do not fix themselves on the next message: a business that landed on the roster nameless (they send no `pushName`), a conversation APX opened before a send was a vouch and so cannot continue, a menu written into the ledger as `[empty message]` by a decoder that did not know the shape, and a contact whose turn a restart killed mid-thought — WhatsApp does not deliver that message twice.

```bash
apx whatsapp chats             # what is wrong, changes nothing
apx whatsapp repair            # fix it   (--dry-run to see it first, --force to retry a phone that was offline)
apx whatsapp status
```

`repair` will: link a person's other address, name a row from what the ledger already heard, make a guest APX wrote to first answerable (`pending_review: true` — answerable, not vetted), and **ask the phone for any message that arrived unreadable** (`requestPlaceholderResend`: the phone still has it, and a resend is recognised as a repair, never re-answered or re-reported). A recovered menu comes back with its options, so the panel draws the buttons.

It will NOT invent a name, promote anyone the owner has decided about, merge two rows that may each hold owner-written notes, or answer a message on its own. A chat nobody answered is **reported** — writing to somebody hours later is the owner's call, not a repair's.

The same two verbs are on the API (`GET /api/whatsapp/repair` asks, `POST` fixes) and a tap on a menu drawn in the panel goes through `POST /api/whatsapp/choose`.

## When something looks wrong

- **Connected but nobody is answered, including the owner** — check `owner_jid`. Empty means everyone resolves as a stranger.
- **`logged_out`** — the credentials are dead and the plugin will NOT retry on its own (retrying dead credentials in a loop is how an account gets flagged). The owner has to pair again.
- **Idle after a restart with no session** — expected when nothing has ever been paired; the daemon does not open a socket or produce a QR unasked.
- **A contact wrote and got nothing back** — most often a restart landed while the turn was running; the message is delivered, so nothing will retry it. `apx whatsapp chats` lists every chat in that state, with the words, so it can be answered by hand.
- **A thread titled by a raw address, or a message reading `[empty message]`** — `apx whatsapp repair`.
