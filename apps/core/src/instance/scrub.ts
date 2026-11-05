// What keeps secret values out of an export: every stored value found in the file becomes its `secret://` name, then
// the redaction durable data gets (credential fields, key shapes). See DECISIONS.md#d-192
import { redactedJson } from "../log.ts";
import { type Secrets, splitSecretName } from "../secrets.ts";

/** Values shorter than this are not looked for: a few letters would match ordinary words. */
const MIN_LENGTH = 6;

export type KnownSecret = { ref: string; value: string };

/** The values this install keeps, longest first (so a value inside another is replaced after it). */
export function knownSecrets(secrets: Pick<Secrets, "list" | "resolve">): KnownSecret[] {
  return secrets
    .list()
    .flatMap(({ name }) => {
      const value = secrets.resolve(`secret://${name}`);
      return value && value.length >= MIN_LENGTH ? [{ ref: `secret://${splitSecretName(name).name}`, value }] : [];
    })
    .sort((a, b) => b.value.length - a.value.length);
}

/** The value as JSON-safe data with no secret value left in it. */
export function scrubbed<T>(value: T, known: readonly KnownSecret[]): T {
  let text = JSON.stringify(value);
  for (const s of known) {
    // As the value reads inside a JSON string (quotes and backslashes escaped).
    const inJson = JSON.stringify(s.value).slice(1, -1);
    if (text.includes(inJson)) text = text.split(inJson).join(s.ref);
  }
  return JSON.parse(redactedJson(JSON.parse(text))) as T;
}

/** Whether any stored value still reads in the text: an export that would carry one is never handed out. */
export const carriesSecret = (text: string, known: readonly KnownSecret[]) =>
  known.some((s) => text.includes(JSON.stringify(s.value).slice(1, -1)));

/** Every `secret://` name the data refers to. */
export function secretRefs(value: unknown): string[] {
  const names = new Set<string>();
  for (const m of JSON.stringify(value).matchAll(/secret:\/\/([A-Za-z0-9_.:~/-]{1,200})/g)) names.add(m[1] as string);
  return [...names].sort();
}
