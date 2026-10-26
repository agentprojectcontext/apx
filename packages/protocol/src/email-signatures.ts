import { z } from "zod";
import type { MethodDef } from "./methods.ts";

const TAGS = new Set(["p", "div", "span", "b", "strong", "em", "i", "u", "br", "a", "img"]);
const VOID = new Set(["br", "img"]);
const hasControl = (value: string) => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const ATTRS: Record<string, readonly string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "title", "width", "height"],
};

/** A small inert HTML fragment; unsupported markup is rejected rather than silently rewritten. */
export function safeSignatureHtml(html: string): boolean {
  const stack: string[] = [];
  let rest = html;
  while (rest) {
    const next = rest.indexOf("<");
    if (next < 0) return stack.length === 0;
    rest = rest.slice(next);
    const tag = /^<(\/?)([a-z]+)((?:[\t\n\f\r ]+[a-z]+[\t\n\f\r ]*=[\t\n\f\r ]*"[^"<>]*")*)[\t\n\f\r ]*(\/?)>/i.exec(
      rest,
    );
    if (!tag) return false;
    rest = rest.slice(tag[0].length);
    const name = tag[2]?.toLowerCase() ?? "";
    if (!TAGS.has(name)) return false;
    const attrs = tag[3] ?? "";
    if (tag[1]) {
      if (attrs.trim() || tag[4] || VOID.has(name) || stack.pop() !== name) return false;
      continue;
    }
    const seen = new Set<string>();
    for (const attr of attrs.matchAll(/[\t\n\f\r ]+([a-z]+)[\t\n\f\r ]*=[\t\n\f\r ]*"([^"<>]*)"/gi)) {
      const key = attr[1]?.toLowerCase() ?? "";
      const value = attr[2] ?? "";
      if (seen.has(key) || !ATTRS[name]?.includes(key)) return false;
      seen.add(key);
      if (key === "href" || key === "src") {
        // Entity-encoded URLs are intentionally unsupported to keep validation and browser interpretation aligned.
        if (/[&\s]/.test(value) || hasControl(value)) return false;
        try {
          const url = new URL(value);
          if (
            url.username ||
            url.password ||
            !(url.protocol === "https:" || (key === "href" && url.protocol === "mailto:"))
          )
            return false;
        } catch {
          return false;
        }
      }
      if ((key === "width" || key === "height") && !/^[1-9]\d{0,3}$/.test(value)) return false;
    }
    if (!VOID.has(name)) {
      if (tag[4]) return false;
      stack.push(name);
      if (stack.length > 20) return false;
    }
  }
  return stack.length === 0;
}

export const EmailSignatureEntry = z
  .object({
    transport: z.enum(["gmail", "smtp"]),
    /** Gmail account address, or the SMTP channel id. */
    account: z
      .string()
      .min(1)
      .max(254)
      .refine((value) => !/\s/.test(value) && !hasControl(value), "Invalid account"),
    sender: z.email().max(254),
    enabled: z.boolean(),
    text: z.string().trim().min(1).max(10_000),
    html: z.string().max(30_000).refine(safeSignatureHtml, "Unsupported signature HTML").optional(),
  })
  .strict();
export type EmailSignatureEntry = z.infer<typeof EmailSignatureEntry>;

export const EmailSignatures = z
  .array(EmailSignatureEntry)
  .max(100)
  .refine((entries) => {
    const keys = entries.map((e) =>
      JSON.stringify([
        e.transport,
        e.transport === "gmail" ? e.account.toLowerCase() : e.account,
        e.sender.toLowerCase(),
      ]),
    );
    return new Set(keys).size === keys.length;
  }, "Duplicate signature account and sender");

export const EmailSignatureKey = EmailSignatureEntry.pick({ transport: true, account: true, sender: true });

export const emailSignatureMethods = {
  "email.signature_upsert": {
    params: z.object({ signature: EmailSignatureEntry, expected: EmailSignatureEntry.nullable() }).strict(),
    result: z.object({ signature: EmailSignatureEntry }),
    effect: true,
    access: "human",
  },
  "email.signature_remove": {
    params: z.object({ key: EmailSignatureKey, expected: EmailSignatureEntry }).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  },
  "email.signatures_get": {
    params: z.object({}).strict(),
    result: z.object({ signatures: EmailSignatures }),
    effect: false,
    access: "human",
  },
  "email.signatures_set": {
    params: z.object({ signatures: EmailSignatures }).strict(),
    result: z.object({ signatures: EmailSignatures }),
    effect: true,
    access: "human",
  },
} as const satisfies Record<string, MethodDef>;
