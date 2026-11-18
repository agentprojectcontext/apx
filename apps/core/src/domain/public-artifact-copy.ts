import { createHash, randomBytes } from "node:crypto";
import { ArtifactBundle, type Surface } from "@apx/protocol";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const PUBLIC_ARTIFACT_LIMITS = { count: 20, bytes: 4_200_000, accountBytes: 84_000_000 } as const;

export function publicArtifactCode(): string {
  return Array.from(randomBytes(8), (byte) => ALPHABET[byte & 31]).join("");
}

export function isPublicArtifactCode(value: string): boolean {
  return /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/.test(value);
}

/** The state keys are selected by the owner; neither artifact memory nor provenance enters this copy. */
export function publicArtifactCopy(
  surface: Pick<Surface, "name" | "title" | "html" | "version" | "app" | "state">,
  stateKeys: readonly string[] = [],
): { bundle: ArtifactBundle; json: string; bytes: number; sha256: string } {
  if (stateKeys.length > 1000 || new Set(stateKeys).size !== stateKeys.length) {
    throw new Error("Choose at most 1000 different state keys");
  }
  const state = Object.create(null) as Record<string, unknown>;
  for (const key of stateKeys) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error("This state key cannot be published");
    }
    if (!key.length || key.length > 100 || !surface.state || !Object.hasOwn(surface.state, key)) {
      throw new Error("A selected state key is no longer available");
    }
    state[key] = surface.state[key];
  }
  const copy = {
    format: "apx-artifact@1",
    manifest: {
      name: surface.name,
      title: surface.title,
      kind: surface.app ? "app" : "widget",
      version: surface.version,
    },
    html: surface.html,
    ...(stateKeys.length ? { state } : {}),
  };
  // Round-trip before validation: undefined, cycles and non-JSON values must not change the approved copy.
  const json = JSON.stringify(copy, (_key, value: unknown) => {
    if (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint" ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new Error("Public artifacts can contain only JSON values");
    }
    return value;
  });
  if (/secret:\/\//i.test(json)) throw new Error("Remove secret references before publishing");
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > PUBLIC_ARTIFACT_LIMITS.bytes) throw new Error("This public copy is too large");
  const bundle = ArtifactBundle.parse(JSON.parse(json));
  return { bundle, json, bytes, sha256: createHash("sha256").update(json, "utf8").digest("hex") };
}

export function publicArtifactUsage(
  current: { count: number; bytes: number },
  nextBytes: number,
  previousBytes?: number,
): { count: number; bytes: number } {
  for (const value of [
    current.count,
    current.bytes,
    nextBytes,
    ...(previousBytes === undefined ? [] : [previousBytes]),
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid public artifact usage");
  }
  if (nextBytes > PUBLIC_ARTIFACT_LIMITS.bytes) throw new Error("This public copy is too large");
  if (previousBytes !== undefined && (current.count === 0 || previousBytes > current.bytes)) {
    throw new Error("Invalid public artifact usage");
  }
  const count = current.count + (previousBytes === undefined ? 1 : 0);
  const bytes = current.bytes - (previousBytes ?? 0) + nextBytes;
  if (count > PUBLIC_ARTIFACT_LIMITS.count || bytes > PUBLIC_ARTIFACT_LIMITS.accountBytes) {
    throw new Error("Your public artifact limit has been reached");
  }
  return { count, bytes };
}
