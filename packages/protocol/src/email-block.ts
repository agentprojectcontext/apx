// An email an agent shows the owner, written as a ```email block: header lines, a blank line, then the body. With
// `To` it is a draft the owner can send; with only `From` it is a mail they received. Shared by the panel and the phone.

export type EmailBlock = {
  to: string[];
  cc: string[];
  from: string;
  subject: string;
  date: string;
  body: string;
};

/** The block's language: what an agent writes after the backticks. */
export const EMAIL_LANG = "email";

// The owner's language may leak into the keys ("Asunto:"): both read the same.
const KEYS: Record<string, keyof Omit<EmailBlock, "body">> = {
  to: "to",
  para: "to",
  cc: "cc",
  from: "from",
  de: "from",
  subject: "subject",
  asunto: "subject",
  date: "date",
  fecha: "date",
};
const HEADER = /^([A-Za-z]+)\s*:\s*(.*)$/;
const ADDRESS = /[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/g;

/** The addresses in a header's value ("Ana <ana@example.com>, bo@example.com"), in order. */
export const addressesIn = (value: string): string[] => value.match(ADDRESS) ?? [];

/** The block as an email, or undefined when it does not start with at least `To`, `From` or `Subject`. */
export function parseEmailBlock(code: string): EmailBlock | undefined {
  const lines = code.replace(/\r\n/g, "\n").replace(/^\n+/, "").split("\n");
  const mail: EmailBlock = { to: [], cc: [], from: "", subject: "", date: "", body: "" };
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) break;
    const m = HEADER.exec(line);
    const key = m ? KEYS[m[1]?.toLowerCase() ?? ""] : undefined;
    if (!m || !key) break;
    const value = (m[2] ?? "").trim();
    if (key === "to" || key === "cc") mail[key].push(...addressesIn(value));
    else mail[key] = value;
  }
  if (!mail.to.length && !mail.from && !mail.subject) return undefined;
  mail.body = lines
    .slice(i)
    .join("\n")
    .replace(/^\n+|\s+$/g, "");
  return mail;
}

/** A draft the owner sends; anything else is a mail they received. */
export const isDraft = (mail: EmailBlock) => mail.to.length > 0;

const query = (pairs: Array<[string, string]>) =>
  pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

/** Where a draft opens to be sent by hand: the device's mail app, or a webmail's compose page. */
export const MAIL_APPS = ["mailto", "gmail", "outlook"] as const;
export type MailApp = (typeof MAIL_APPS)[number];

export function composeUrl(app: MailApp, mail: EmailBlock): string {
  const to = mail.to.join(",");
  const cc = mail.cc.join(",");
  switch (app) {
    case "gmail":
      return `https://mail.google.com/mail/?${query([
        ["view", "cm"],
        ["fs", "1"],
        ["to", to],
        ["cc", cc],
        ["su", mail.subject],
        ["body", mail.body],
      ])}`;
    case "outlook":
      return `https://outlook.office.com/mail/deeplink/compose?${query([
        ["to", to],
        ["cc", cc],
        ["subject", mail.subject],
        ["body", mail.body],
      ])}`;
    default: {
      const q = query([
        ["cc", cc],
        ["subject", mail.subject],
        ["body", mail.body],
      ]);
      return `mailto:${mail.to.map(encodeURIComponent).join(",")}${q ? `?${q}` : ""}`;
    }
  }
}

/** The draft as text to paste in any mail app. */
export function emailText(mail: EmailBlock): string {
  const head = [
    mail.to.length ? `To: ${mail.to.join(", ")}` : mail.from ? `From: ${mail.from}` : "",
    mail.cc.length ? `Cc: ${mail.cc.join(", ")}` : "",
    mail.subject ? `Subject: ${mail.subject}` : "",
  ].filter(Boolean);
  return [head.join("\n"), mail.body].filter(Boolean).join("\n\n");
}

/** A mail that reached the email channel, as its chat keeps it: `[subject: …]` on the first line when it has one. */
export function receivedMail(text: string): { subject: string; body: string } {
  const m = /^\[subject: ([^\]\n]*)\]\n?/.exec(text);
  return m ? { subject: m[1] ?? "", body: text.slice(m[0].length) } : { subject: "", body: text };
}

/** A short stable key for one draft, so the same block is never sent twice. */
export function draftKey(messageId: string, mail: EmailBlock): string {
  let h = 2166136261;
  for (const c of `${mail.to.join(",")}|${mail.cc.join(",")}|${mail.subject}|${mail.body}`) {
    h ^= c.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return `${messageId}:${(h >>> 0).toString(36)}`;
}
