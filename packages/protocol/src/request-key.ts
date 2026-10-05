// Idempotency keys need secure randomness in browsers, Node and native clients.
type RandomSource = {
  randomUUID?: () => string;
  getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
};

/** Web Crypto also works on HTTP origins where randomUUID is unavailable. */
export function secureRequestKey(source: RandomSource = globalThis.crypto): string {
  if (source?.randomUUID) return source.randomUUID();
  if (!source?.getRandomValues) throw new Error("This client needs a secure request key generator");
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
