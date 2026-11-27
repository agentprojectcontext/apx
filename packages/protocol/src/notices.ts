import { type NoticeKey, noticeEn } from "./notices-en.ts";
import { noticeEs } from "./notices-es.ts";

export { type NoticeKey, noticeEn } from "./notices-en.ts";
export { noticeEs } from "./notices-es.ts";

const NOTICES = { en: noticeEn, es: noticeEs } as const;

const fill = (text: string, vars: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** The key a notice reads from: its code, and the wording its `variant` picks (`notice.<code>.<variant>`). */
export const noticeKey = (part: { code: string; vars?: Record<string, string | number> | undefined }) =>
  `notice.${part.code}${part.vars?.variant ? `.${part.vars.variant}` : ""}`;

/**
 * Whether a notice reads from its translation: there is one and the notice is the plain case (it has vars, its English
 * is the known wording, or it carries no details after a colon); else the core's own text is shown.
 */
export function plainNotice(part: { code: string; text: string; vars?: Record<string, string | number> | undefined }) {
  const key = noticeKey(part);
  if (!Object.hasOwn(noticeEn, key)) return false;
  return Boolean(part.vars) || !part.text.includes(":") || part.text === noticeEn[key as NoticeKey];
}

/** A notice in `lang`: its translation in the plain case (see `plainNotice`), else the core's own text. */
export function noticeText(
  part: { code: string; text: string; vars?: Record<string, string | number> | undefined },
  lang: keyof typeof NOTICES,
): string {
  if (!plainNotice(part)) return part.text;
  return fill(NOTICES[lang][noticeKey(part) as NoticeKey], part.vars);
}

/**
 * The chat app the owner picked for notices, as every app shows it: "auto" (the first that knows them), a channel's id,
 * or "none" (the app and paired phones only). A phone picked before every phone was told is "none" (DECISIONS.md#d-161).
 */
export const noticeChannelChoice = (channel: string | undefined): string =>
  !channel ? "auto" : channel === "none" || channel.startsWith("device:") ? "none" : channel;

const RESTART_CODES: ReadonlySet<string> = new Set(["run.interrupted", "run.resumed"]);

/** What the core says after a restart cut a turn: a line of the system's, never the agent's words. */
export const isRestartNotice = (part: { type: string; code?: string }): boolean =>
  part.type === "notice" && RESTART_CODES.has(part.code ?? "");

/**
 * The messages whose restart line is not shown because a later one says it again (a turn resumed after one restart and
 * cut by the next): the latest stands for the run. An owner message in between starts the count over.
 */
export function supersededRestarts(
  messages: readonly { id: string; author: { kind: string }; parts: readonly { type: string; code?: string }[] }[],
): ReadonlySet<string> {
  const out = new Set<string>();
  let last: string | undefined;
  for (const m of messages) {
    if (m.author.kind === "user") last = undefined;
    else if (m.parts.some(isRestartNotice)) {
      if (last) out.add(last);
      last = m.id;
    }
  }
  return out;
}
