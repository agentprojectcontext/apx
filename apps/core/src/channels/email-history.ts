import type { Inbound } from "../domain/channels.ts";
import type { Imap } from "./email-imap.ts";
import type { MailHistoryRequest, MailHistoryResult, RestoreMail } from "./types.ts";

/** A separate read-only session cannot interrupt IDLE or advance the live mailbox cursor. */
export async function readMailHistory(opts: {
  request: MailHistoryRequest;
  connect: (signal: AbortSignal) => Promise<Imap>;
  signal: AbortSignal;
  mailbox: string;
  boundary: { uidvalidity: number | undefined; last_uid: number };
  maxFetch: number;
  message: (
    raw: Buffer,
    uid: number,
    truncated: boolean,
    history: { validity: number; arrived?: number | undefined },
  ) => Inbound | undefined;
  receive: RestoreMail;
}): Promise<MailHistoryResult> {
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(90_000)]);
  const box = await opts.connect(signal);
  try {
    const info = await box.examine(opts.mailbox);
    if (
      info.uidvalidity <= 0 ||
      info.uidvalidity !== opts.boundary.uidvalidity ||
      (opts.request.after_uid > 0 && opts.request.uidvalidity === undefined) ||
      (opts.request.uidvalidity !== undefined && opts.request.uidvalidity !== info.uidvalidity)
    )
      throw new Error("the mailbox numbering changed or is missing; restart recovery from the first page");
    const all = (await box.search(`UID ${opts.request.after_uid + 1}:*`))
      .filter((uid) => uid > opts.request.after_uid && uid <= opts.boundary.last_uid)
      .sort((a, b) => a - b);
    const page = all.slice(0, opts.request.limit);
    const result: MailHistoryResult = {
      uidvalidity: info.uidvalidity,
      next_uid: opts.request.after_uid,
      has_more: all.length > page.length,
      scanned: 0,
      stored: 0,
      already_seen: 0,
      skipped: 0,
      failed: 0,
    };
    for (const uid of page) {
      signal.throwIfAborted();
      const got = await box.fetch(uid, opts.maxFetch);
      const incoming = got
        ? opts.message(got.raw, uid, got.size > got.raw.length, {
            validity: info.uidvalidity,
            arrived: got.arrived,
          })
        : undefined;
      const outcome = incoming ? await opts.receive(incoming) : "skipped";
      result[outcome]++;
      result.scanned++;
      if (outcome === "failed") {
        result.has_more = true;
        break;
      }
      result.next_uid = uid;
    }
    return result;
  } finally {
    box.close();
  }
}
