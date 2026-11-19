import { errorMessage } from "../errors.ts";
import { redactSecrets } from "../redact-secrets.ts";

export const MCP_SECRET_REF = /secret:\/\/([a-zA-Z0-9_.-]+)/g;

/** Keep the values used by this connection even if the owner rotates them before a failure arrives. */
export function connectionErrors(resolve: (reference: string) => string | undefined) {
  const values = new Set<string>();
  const captured = (reference: string) => {
    const value = resolve(reference);
    if (value) {
      values.add(value);
      values.add(JSON.stringify(value).slice(1, -1));
    }
    return value;
  };
  const mask = (text: string) => {
    for (const value of [...values].sort((a, b) => b.length - a.length)) text = text.split(value).join("[secret]");
    return text;
  };
  return {
    fill(text: string): string {
      return captured(text) ?? text.replace(MCP_SECRET_REF, (reference) => captured(reference) ?? reference);
    },
    message(error: unknown): string {
      // A peer-controlled redirect target can encode credentials in arbitrary ways, including opaque URLs.
      const message = mask(
        errorMessage(error)
          .replace(/\bRedirect to\b[\s\S]*/i, "Redirect to [secret] not followed")
          .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi, "[secret]"),
      );
      const decoded = message.replace(/(?:%[a-f\d]{2})+/gi, (bytes) =>
        Buffer.from(bytes.replaceAll("%", ""), "hex").toString("utf8"),
      );
      const hidden = mask(decoded);
      return redactSecrets(hidden === decoded ? message : hidden);
    },
  };
}
