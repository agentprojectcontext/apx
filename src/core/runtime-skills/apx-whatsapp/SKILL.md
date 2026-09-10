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

## Media

Inbound is handled before the turn: voice notes arrive transcribed as `[audio] …`, photos as pixels a vision model can see, stickers as `[sticker: <meaning>]`, GIFs as their first frame. **Video is refused** — say so plainly rather than guessing from the caption.

Stickers are learned once: the first sighting is described by a vision model and stored by content hash in `~/.apx/whatsapp/stickers.json`; every later sighting reuses those words. The owner can overwrite the wording and the model will never overwrite it back.

## Why the owner is always told, and only sometimes

The report to the owner is emitted by the daemon, not by the model — a sealed turn has no tools and could not escalate even if it wanted to. It is coalesced per correspondent (6 h for someone off the roster, 15 min for a real conversation), because the report is reactive and therefore does not spend the interruption budget: without its own limit, one stranger sending a hundred messages would be a hundred notifications.

So: do not tell a WhatsApp contact that you will "escalate" or "pass this to my owner and come back" as if you were arranging it. It already happened.

## When something looks wrong

- **Connected but nobody is answered, including the owner** — check `owner_jid`. Empty means everyone resolves as a stranger.
- **`logged_out`** — the credentials are dead and the plugin will NOT retry on its own (retrying dead credentials in a loop is how an account gets flagged). The owner has to pair again.
- **Idle after a restart with no session** — expected when nothing has ever been paired; the daemon does not open a socket or produce a QR unasked.
