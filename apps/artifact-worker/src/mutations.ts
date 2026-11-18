import { verifyPublicCopy } from "@apx/protocol/public-copy";
import type { metadataCloud, Session } from "./metadata.ts";
import type { PendingCopy } from "./recovery.ts";
import { type Bucket, bodyKey, type Pointer, pointer, pointerKey, setPointer } from "./storage.ts";

async function boundedText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new Error("public_artifact_too_large");
  if (!request.body) throw new Error("invalid_public_copy");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void reader.cancel();
      reject(new Error("public_artifact_unavailable"));
    }, 10_000);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const parts: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > limit) throw new Error("public_artifact_too_large");
          parts.push(result.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
      })(),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await reader.cancel();
  }
}

export async function mutate(
  request: Request,
  deps: {
    bucket: Bucket;
    session: Session;
    cloud: ReturnType<typeof metadataCloud>;
    code: string;
    action: "publish" | "update" | "revoke";
    revoked?: Pointer;
    rememberRevocation(value: Pointer): Promise<void>;
    rememberPending(value: PendingCopy): Promise<void>;
  },
) {
  const { bucket, session, cloud, code, action } = deps;
  const old = (action === "revoke" && deps.revoked) || (await pointer(bucket, code));
  if (old && old.uid !== session.uid) throw new Error("public_artifact_access_denied");
  if (!old && action !== "publish") throw new Error("public_artifact_missing");
  const expected = request.headers.get("x-artifact-revision");
  if (action === "revoke" && old) {
    if (!deps.revoked && old.meta.revision !== expected) throw new Error("public_artifact_changed");
    await deps.rememberRevocation(old);
    // Pointer deletion needs no R2 write allocation and precedes best-effort Firebase cleanup.
    await bucket.delete(pointerKey(code));
    let cleanupPending = false;
    try {
      await cloud.release(code, old.slot);
    } catch {
      cleanupPending = true;
    }
    try {
      await bucket.delete(bodyKey(code, old.meta.sha256));
    } catch {
      cleanupPending = true;
    }
    return { ok: true, cleanup_pending: cleanupPending };
  }
  const json = await boundedText(request, 4_200_000);
  let raw: { manifest?: { title?: unknown } };
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_public_copy");
    raw = parsed as typeof raw;
  } catch {
    throw new Error("invalid_public_copy");
  }
  const bytes = new TextEncoder().encode(json);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const title = raw.manifest?.title;
  const copy = await verifyPublicCopy(json, { bytes: bytes.length, sha256, title }).catch(() => {
    throw new Error("invalid_public_copy");
  });
  if (old && old.meta.sha256 === copy.sha256) return { code, sha256 };
  if (old && action === "publish") throw new Error("public_artifact_changed");
  if (action === "update" && old?.meta.revision !== expected) throw new Error("public_artifact_changed");
  const meta = {
    title: copy.bundle.manifest.title,
    sha256,
    bytes: bytes.length,
    revision: crypto.randomUUID(),
    updated_at: new Date().toISOString(),
  };
  const pending = { sha256, ...(old ? { previous: old.meta.sha256 } : {}), owned: !!old, acknowledged: false };
  await deps.rememberPending(pending);
  const slot = await cloud.reserve(code, meta);
  const target = { uid: session.uid, slot, meta };
  await deps.rememberPending({ ...pending, owned: true, target });
  await bucket.put(bodyKey(code, sha256), json, { httpMetadata: { contentType: "application/vnd.apx.artifact+json" } });
  await deps.rememberPending({ ...pending, owned: true, target, acknowledged: true });
  await setPointer(bucket, code, target);
  return { code, sha256 };
}
