const MAX_BYTES = 8 * 1024 * 1024;

/** Bound provider bytes while reading, before JSON decoding or audio conversion can allocate more. */
export async function readSpeechBody(response: Response, signal: AbortSignal, max = MAX_BYTES): Promise<Buffer> {
  signal.throwIfAborted();
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > max) throw new Error("speech response is too large");
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > max) throw new Error("speech response is too large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
