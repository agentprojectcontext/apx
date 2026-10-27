// Minimal structured logger (JSON lines on stderr). Swappable for pino later without touching callers.
export type Log = {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
};

const REDACTED = "[redacted]";

/** Field names whose string value is a credential (camelCase is read as snake_case: apiKey is api_key). */
const SECRET_KEY =
  /(?:^|_)(?:pass(?:word|wd)?|secret|token|auth(?:orization)?|cookie|credentials?|bearer)(?:$|_)|api_?key|private_?key|set_cookie/i;

/** Credential shapes that can turn up anywhere in a string: provider keys, chat bot tokens, JWTs, bearer headers. */
const SECRET_SHAPE = new RegExp(
  [
    String.raw`\bsk-[A-Za-z0-9_-]{16,}`,
    String.raw`\bapx[pc]_[a-f0-9]{48,64}`,
    String.raw`\bgh[pousr]_[A-Za-z0-9]{20,}`,
    String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}`,
    String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
    String.raw`\bAIza[A-Za-z0-9_-]{30,}`,
    // No \b in front: Telegram's API puts it right after "bot" in its URLs.
    String.raw`\d{5,}:[A-Za-z0-9_-]{30,}`,
    String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*`,
    String.raw`\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}`,
    String.raw`[?&](?:access_token|token|key|api_key|apikey|secret|password|sig)=[^&\s"']+`,
  ].join("|"),
  "g",
);

function scrub(text: string): string {
  // Most log strings are short ids and states: skip the pattern for them.
  if (text.length < 16) return text;
  return text.replace(SECRET_SHAPE, (m) => {
    if (m[0] === "?" || m[0] === "&") return `${m.slice(0, m.indexOf("=") + 1)}${REDACTED}`;
    return /^bearer/i.test(m) ? `${m.slice(0, 6)} ${REDACTED}` : REDACTED;
  });
}

const secretKey = (key: string) => SECRET_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_"));

/** What a log line may carry: secrets by reference (`secret://…`) stay, their values never do. */
function redact(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (key && secretKey(key) && value && !value.startsWith("secret://")) return REDACTED;
  return scrub(value);
}

/** JSON for durable external data: redact credential fields (including nested objects) and recognizable key shapes. */
export function redactedJson(value: unknown): string {
  const text = JSON.stringify(value, (key, item: unknown) => {
    if (key && scrub(key) !== key) return undefined;
    if (key && secretKey(key) && item && !(typeof item === "string" && item.startsWith("secret://"))) return REDACTED;
    return redact(key, item);
  });
  if (text === undefined) throw new Error("Invalid JSON value");
  return text;
}

export function createLog(
  scope: string,
  quiet = false,
  sink: (line: string) => void = (line) => process.stderr.write(line),
): Log {
  const write = (level: string) => (fields: Record<string, unknown>, msg: string) => {
    if (quiet) return;
    sink(`${JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...fields }, redact)}\n`);
  };
  return { info: write("info"), warn: write("warn"), error: write("error") };
}
