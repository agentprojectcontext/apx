import type { EmailBody } from "./email-body.ts";

export type EmailSignature = {
  text: string;
  html?: string | undefined;
};

/** Keep the current author's content separate from history until the final MIME rendering. */
export type EmailDraft = {
  content: EmailBody;
  quoted?: EmailBody | undefined;
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

export const textHtml = (text: string): string => escapeHtml(text).replace(/\r?\n/g, "<br>\n");

const normalized = (text: string) => text.replace(/\r\n/g, "\n").trimEnd();

/** HTML is a validated configuration fragment, not arbitrary incoming mail. */
export function withEmailSignature(
  draft: EmailDraft,
  signature: EmailSignature | undefined,
  options: { omit?: boolean } = {},
): EmailDraft {
  if (!signature?.text.trim() || options.omit) return draft;
  const body = draft.content;
  const text = normalized(body.text);
  const footer = normalized(signature.text);
  const hasText = text === footer || text.endsWith(`\n${footer}`);
  const htmlFooter = signature.html || textHtml(signature.text);
  const htmlSignature = `<div>${htmlFooter}</div>`;
  const needsHtml = body.html !== undefined || signature.html !== undefined;
  const ownText = hasText ? body.text : `${body.text}\n\n-- \n${footer}`;
  let html =
    body.html ?? (hasText ? `${textHtml(text.slice(0, -footer.length))}${htmlSignature}` : textHtml(body.text));
  const trimmedHtml = html.trimEnd();
  const hasHtml = trimmedHtml === htmlFooter.trimEnd() || trimmedHtml.endsWith(htmlSignature);
  if (!hasHtml) html += `<br><br>${htmlSignature}`;
  return { ...draft, content: { text: ownText, ...(needsHtml ? { html } : {}) } };
}

export function renderEmailDraft({ content, quoted }: EmailDraft): EmailBody {
  if (!quoted) return content;
  return {
    text: `${content.text}\n\n${quoted.text}`,
    ...(content.html !== undefined || quoted.html !== undefined
      ? {
          html: `${content.html ?? textHtml(content.text)}<br><br><blockquote>${quoted.html ?? textHtml(quoted.text)}</blockquote>`,
        }
      : {}),
  };
}
