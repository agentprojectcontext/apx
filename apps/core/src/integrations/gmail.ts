// Gmail's REST API: searching and reading the owner's mail, writing a draft, and sending a draft the owner approved.
// Direct sending is used only with APX's send-only OAuth client; drafts keep the owner's final approval path.
import { emailMimeBody } from "../domain/email-body.ts";
import { renderEmailDraft, withEmailSignature } from "../domain/email-signature.ts";
import { pageText } from "../tools/web.ts";
import type { Google } from "./google.ts";

const ID = "gmail" as const;
const BODY_CAP = 8_000;

type Header = { name?: string; value?: string };
type Part = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: Part[];
  headers?: Header[];
};
type GMessage = { id?: string; threadId?: string; snippet?: string; labelIds?: string[]; payload?: Part };

export type MailSummary = {
  id: string;
  thread: string;
  from: string;
  to?: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
};

const header = (m: GMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

export function summary(m: GMessage): MailSummary {
  const to = header(m, "To");
  return {
    id: m.id ?? "",
    thread: m.threadId ?? "",
    from: header(m, "From"),
    ...(to ? { to } : {}),
    subject: header(m, "Subject") || "(no subject)",
    date: header(m, "Date"),
    snippet: m.snippet ?? "",
    unread: Boolean(m.labelIds?.includes("UNREAD")),
  };
}

const decode = (data: string | undefined) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

/** The readable body: the plain-text part, else the HTML one as text. Attachments only by name. */
export function bodyOf(p: Part | undefined): { text: string; attachments: string[] } {
  const all: Part[] = [];
  const walk = (x: Part | undefined) => {
    if (!x) return;
    all.push(x);
    for (const c of x.parts ?? []) walk(c);
  };
  walk(p);
  const attachments = all.flatMap((x) => (x.filename ? [x.filename] : []));
  const plain = all.find((x) => x.mimeType === "text/plain" && !x.filename && x.body?.data);
  if (plain) return { text: decode(plain.body?.data), attachments };
  const html = all.find((x) => x.mimeType === "text/html" && !x.filename && x.body?.data);
  if (html) return { text: pageText(decode(html.body?.data), "https://mail.google.com/").text, attachments };
  return { text: "", attachments };
}

/** RFC 2047, so a subject or a name outside ASCII arrives as written. */
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** A header's value on one line: a line break in it would start a header (or the body) of its own. */
const one = (s: string) => s.replace(/[\r\n]+/g, " ");

/** An RFC 2822 message as Gmail's `raw` (base64url). */
export function rawMessage(m: {
  to: string[];
  cc?: string[] | undefined;
  subject: string;
  body: string;
  html?: string | undefined;
  inReplyTo?: string | undefined;
  references?: string | undefined;
}): string {
  const lines = [
    `To: ${one(m.to.join(", "))}`,
    ...(m.cc?.length ? [`Cc: ${one(m.cc.join(", "))}`] : []),
    `Subject: ${word(one(m.subject))}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${one(m.inReplyTo)}`, `References: ${one(m.references || m.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    emailMimeBody({ text: m.body, html: m.html }),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/** A message that just reached the inbox, with what is needed to judge whether it matters. */
export type Arrival = MailSummary & { labels: string[] };

type Composition = {
  body: string;
  omit_signature?: boolean | undefined;
  quoted_body?: string | undefined;
};

export function gmailApi(g: Google) {
  const signedBody = (o: Composition) => {
    const body = renderEmailDraft(
      withEmailSignature(
        { content: { text: o.body }, ...(o.quoted_body ? { quoted: { text: o.quoted_body } } : {}) },
        g.emailSignature(),
        { omit: o.omit_signature },
      ),
    );
    return { body: body.text, html: body.html };
  };
  const base = () => `${g.endpoints.gmail}/users/me`;
  // Metadata with the headers asked for: Gmail repeats the parameter, which a query object would collapse.
  const meta = (id: string, headers: string[]) => {
    const u = new URL(`${base()}/messages/${encodeURIComponent(id)}`);
    u.searchParams.set("format", "metadata");
    for (const h of headers) u.searchParams.append("metadataHeaders", h);
    return g.call<GMessage>(ID, u.toString());
  };
  return {
    /** Where the mailbox stands now: the point to ask what arrived after. */
    async historyId(): Promise<string> {
      return (await g.call<{ historyId?: string }>(ID, `${base()}/profile`)).historyId ?? "";
    },

    /**
     * Messages added to the inbox after `from` (oldest first, at most `max`), and the point to ask from next time.
     * Undefined when Gmail no longer keeps history that old: start again from now.
     */
    async arrived(from: string, max = 20): Promise<{ next: string; mail: Arrival[] } | undefined> {
      let data: {
        historyId?: string;
        history?: Array<{ messagesAdded?: Array<{ message?: { id?: string; labelIds?: string[] } }> }>;
      };
      try {
        data = await g.call(ID, `${base()}/history`, {
          query: { startHistoryId: from, historyTypes: "messageAdded", labelId: "INBOX", maxResults: 100 },
        });
      } catch (e) {
        if (/not found|404/i.test(e instanceof Error ? e.message : "")) return undefined;
        throw e;
      }
      const ids = [
        ...new Set(
          (data.history ?? []).flatMap((h) =>
            (h.messagesAdded ?? []).flatMap((m) => (m.message?.id ? [m.message.id] : [])),
          ),
        ),
      ].slice(-max);
      const mail = await Promise.all(
        ids.map(async (id) => {
          const m = await meta(id, ["From", "To", "Subject", "Date"]);
          return { ...summary(m), labels: m.labelIds ?? [] };
        }),
      );
      return { next: data.historyId ?? from, mail };
    },

    async search(o: { q: string; max: number }): Promise<MailSummary[]> {
      const list = await g.call<{ messages?: Array<{ id: string }> }>(ID, `${base()}/messages`, {
        query: { q: o.q, maxResults: o.max },
      });
      return Promise.all(
        (list.messages ?? []).map(async (m) => summary(await meta(m.id, ["From", "To", "Subject", "Date"]))),
      );
    },

    async read(id: string) {
      const m = await g.call<GMessage>(ID, `${base()}/messages/${encodeURIComponent(id)}`, {
        query: { format: "full" },
      });
      const { text, attachments } = bodyOf(m.payload);
      const cc = header(m, "Cc");
      return {
        ...summary(m),
        ...(cc ? { cc } : {}),
        body: text.length > BODY_CAP ? `${text.slice(0, BODY_CAP)}\n…[cut]` : text,
        attachments,
      };
    },

    /** A draft in the owner's mailbox; as a reply it goes in the same thread, with "Re:" and the right headers. */
    async draft(
      o: Composition & {
        to: string[];
        cc?: string[] | undefined;
        subject?: string | undefined;
        body: string;
        reply_to?: string | undefined;
      },
    ) {
      let subject = o.subject ?? "";
      let thread: string | undefined;
      let inReplyTo: string | undefined;
      let references: string | undefined;
      if (o.reply_to) {
        const orig = await meta(o.reply_to, ["Subject", "Message-ID", "References"]);
        thread = orig.threadId;
        inReplyTo = header(orig, "Message-ID") || undefined;
        references = [header(orig, "References"), inReplyTo].filter(Boolean).join(" ") || undefined;
        if (!subject) {
          const s = header(orig, "Subject");
          subject = /^re:/i.test(s) ? s : `Re: ${s}`;
        }
      }
      const raw = rawMessage({ to: o.to, cc: o.cc, subject, ...signedBody(o), inReplyTo, references });
      const d = await g.call<{ id?: string; message?: { id?: string; threadId?: string } }>(ID, `${base()}/drafts`, {
        method: "POST",
        body: { message: { raw, ...(thread ? { threadId: thread } : {}) } },
      });
      return { draft: d.id ?? "", message: d.message?.id ?? "", subject };
    },

    /** Sends a new message at once: what APX's own client can do, since drafts and reading need restricted scopes. */
    async send(o: Composition & { to: string[]; cc?: string[] | undefined; subject: string }) {
      const raw = rawMessage({ to: o.to, cc: o.cc, subject: o.subject, ...signedBody(o) });
      const m = await g.call<GMessage>(ID, `${base()}/messages/send`, { method: "POST", body: { raw } });
      return { message: m.id ?? "", thread: m.threadId ?? "" };
    },

    async sendDraft(id: string) {
      const m = await g.call<GMessage>(ID, `${base()}/drafts/send`, { method: "POST", body: { id } });
      return { message: m.id ?? "", thread: m.threadId ?? "" };
    },
  };
}
