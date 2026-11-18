import { ArtifactBundle } from "./domain.ts";

/** Downloads use the edge only and recheck the uncached pointer before handing bytes to an installer. */
export async function readEdgePublicCopy(code: string, deps: { origin?: string; fetch?: typeof fetch } = {}) {
  if (!/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/.test(code)) throw new Error("invalid_public_code");
  const root = `${deps.origin ?? "https://artifact.apxagent.app"}/api/copies/${code}`;
  const signal = AbortSignal.timeout(20_000);
  const read = async (part: string, limit: number) => {
    const init = { cache: "no-store" as const, credentials: "omit" as const, redirect: "error" as const, signal };
    const response = await (deps.fetch ?? fetch)(`${root}/${part}`, init);
    if (!response.ok)
      throw new Error(response.status === 404 ? "public_artifact_missing" : "public_artifact_unavailable");
    if (!response.body) throw new Error("public_artifact_unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) throw new Error("public_artifact_too_large");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  };
  const before = object(JSON.parse(await read("meta", 4096)));
  const copy = await verifyPublicCopy(await read("bundle", 10_000_000), before);
  const after = object(JSON.parse(await read("meta", 4096)));
  if (
    typeof before.revision !== "string" ||
    !before.revision ||
    before.revision !== after.revision ||
    before.sha256 !== after.sha256 ||
    before.bytes !== after.bytes ||
    before.title !== after.title
  )
    throw new Error("public_copy_changed");
  return copy;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_public_copy");
  return value as Record<string, unknown>;
}

export async function verifyPublicCopy(json: string, value: unknown) {
  const meta = object(value);
  const bytes = new TextEncoder().encode(json);
  if (
    bytes.length < 1 ||
    bytes.length > 10_000_000 ||
    bytes.length !== meta.bytes ||
    typeof meta.title !== "string" ||
    !meta.title ||
    meta.title.length > 120 ||
    typeof meta.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(meta.sha256)
  )
    throw new Error("invalid_public_copy");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== meta.sha256) throw new Error("invalid_public_copy");
  const raw = object(JSON.parse(json));
  if (Object.keys(raw).some((key) => !["format", "manifest", "html", "state"].includes(key)))
    throw new Error("invalid_public_copy");
  const manifest = object(raw.manifest);
  if (Object.keys(manifest).some((key) => !["name", "title", "kind", "version"].includes(key)))
    throw new Error("invalid_public_copy");
  const bundle = ArtifactBundle.parse(raw);
  if (bundle.manifest.title !== meta.title) throw new Error("invalid_public_copy");
  return { bundle, json, sha256: hash };
}
