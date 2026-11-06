// Chrome's native messaging framing (a 32-bit length in the machine's byte order, then JSON) and the requests the host
// makes to APX's extension over it.
import { randomUUID } from "node:crypto";
import { ChromeMessage, type ChromeRequest } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";

/** Chrome refuses a message from a host over 1 MB. */
const MAX_OUT = 1024 * 1024;
/** A tab's picture is the largest thing the extension sends. */
export const MAX_IN = 32 * 1024 * 1024;
const REQUEST_MS = 15_000;

export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_OUT) throw new Error("native message too large");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

/** Feeds chunks in, calls back once per whole message; a size out of bounds throws (the stream is not Chrome). */
export function frameReader(onMessage: (value: unknown) => void) {
  let buffered: Buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
    while (buffered.length >= 4) {
      const size = buffered.readUInt32LE(0);
      if (!size || size > MAX_IN) throw new Error("invalid native message size");
      if (buffered.length < size + 4) break;
      const body = buffered.subarray(4, size + 4);
      buffered = buffered.subarray(size + 4);
      onMessage(JSON.parse(body.toString("utf8")));
    }
  };
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> };
type Ask = ChromeRequest extends infer R ? (R extends { id: string } ? Omit<R, "id"> : never) : never;

/** The extension on the other end: requests with answers, and what it reports on its own. */
export class ExtensionLink {
  readonly #send: (frame: unknown) => void;
  readonly #pending = new Map<string, Pending>();
  #closed: string | undefined;
  onEvent: (tab: number, method: string, params: Record<string, unknown>) => void = () => {};
  onDetached: (tab: number, reason: string) => void = () => {};
  onTabs: () => void = () => {};

  constructor(send: (frame: unknown) => void) {
    this.#send = send;
  }

  request<T = unknown>(ask: Ask, ms = REQUEST_MS): Promise<T> {
    if (this.#closed) return Promise.reject(new ApxError({ code: "unavailable", message: this.#closed }));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new ApxError({ code: "timeout", message: "Chrome did not answer in time" }));
      }, ms);
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.#send({ ...ask, id });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** One message from the extension; anything that is not one of its messages is dropped. */
  receive(raw: unknown): void {
    const parsed = ChromeMessage.safeParse(raw);
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.t === "res") {
      const p = this.#pending.get(m.id);
      if (!p) return;
      this.#pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new ApxError({ code: "unavailable", message: m.error ?? "Chrome refused" }));
    } else if (m.t === "event") this.onEvent(m.tab, m.method, m.params ?? {});
    else if (m.t === "detached") this.onDetached(m.tab, m.reason);
    else this.onTabs();
  }

  close(why: string): void {
    this.#closed ??= why;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ApxError({ code: "unavailable", message: why }));
    }
    this.#pending.clear();
  }
}
