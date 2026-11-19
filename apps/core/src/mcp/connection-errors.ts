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
      for (const encode of [encodeURIComponent, encodeURI]) {
        try {
          const encoded = encode(value);
          values.add(encoded);
          values.add(encoded.replace(/%[0-9A-F]{2}/g, (byte) => byte.toLowerCase()));
        } catch {}
      }
      values.add(JSON.stringify(value).slice(1, -1));
    }
    return value;
  };
  return {
    fill(text: string): string {
      return captured(text) ?? text.replace(MCP_SECRET_REF, (reference) => captured(reference) ?? reference);
    },
    message(error: unknown): string {
      let message = errorMessage(error);
      for (const value of [...values].sort((a, b) => b.length - a.length))
        message = message.split(value).join("[secret]");
      return redactSecrets(message);
    },
  };
}
