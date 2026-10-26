import { randomUUID } from "node:crypto";
export type EmailBody = {
  text: string;
  html?: string | undefined;
};

const part = (type: string, text: string): string => {
  const encoded = Buffer.from(text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  return [
    `Content-Type: ${type}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    (encoded.match(/.{1,76}/g) ?? []).join("\r\n"),
  ].join("\r\n");
};

/** A MIME entity, which can also be nested inside multipart/mixed for attachments. */
export function emailMimeBody(body: EmailBody): string {
  const text = part("text/plain", body.text);
  if (body.html === undefined) return text;
  const boundary = `apx-alternative-${randomUUID()}`;
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    text,
    `--${boundary}`,
    part("text/html", body.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
