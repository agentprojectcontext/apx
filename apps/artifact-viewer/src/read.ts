import { ArtifactBundle } from "@apx/protocol";

type Read = (path: string) => Promise<unknown>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_public_copy");
  return value as Record<string, unknown>;
}
function metadata(value: unknown) {
  const data = object(value);
  if (
    typeof data.title !== "string" ||
    !data.title ||
    data.title.length > 120 ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    typeof data.bytes !== "number" ||
    !Number.isSafeInteger(data.bytes) ||
    data.bytes < 1 ||
    data.bytes > 4_200_000 ||
    typeof data.chunk_count !== "number" ||
    !Number.isInteger(data.chunk_count) ||
    data.chunk_count < 1 ||
    data.chunk_count > 8
  )
    throw new Error("invalid_public_copy");
  return { title: data.title, sha256: data.sha256, bytes: data.bytes, chunks: data.chunk_count };
}

/** Every install/download is assembled from server reads and verified against the current publication. */
export async function readPublicCopy(code: string, read: Read) {
  if (!/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/.test(code)) throw new Error("invalid_public_code");
  const path = `publicArtifacts/${code}`;
  const meta = metadata(await read(path));
  const parts = await Promise.all(
    Array.from({ length: meta.chunks }, async (_, i) => {
      const part = object(await read(`${path}/parts/${i}`));
      const value = part.data;
      if (
        typeof value !== "string" ||
        !value.length ||
        value.length > 700_000 ||
        value.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
      ) {
        throw new Error("invalid_public_copy");
      }
      return value;
    }),
  );
  const binary = atob(parts.join(""));
  if (binary.length !== meta.bytes) throw new Error("invalid_public_copy");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== meta.sha256) throw new Error("invalid_public_copy");
  const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const raw = object(JSON.parse(json));
  if (Object.keys(raw).some((key) => !["format", "manifest", "html", "state"].includes(key)))
    throw new Error("invalid_public_copy");
  const manifest = object(raw.manifest);
  if (Object.keys(manifest).some((key) => !["name", "title", "kind", "version"].includes(key)))
    throw new Error("invalid_public_copy");
  const bundle = ArtifactBundle.parse(raw);
  if (bundle.manifest.title !== meta.title) throw new Error("invalid_public_copy");
  const latest = metadata(await read(path));
  if (
    latest.sha256 !== meta.sha256 ||
    latest.bytes !== meta.bytes ||
    latest.chunks !== meta.chunks ||
    latest.title !== meta.title
  ) {
    throw new Error("public_copy_changed");
  }
  return { bundle, json, sha256: hash };
}
