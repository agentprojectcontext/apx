import type { metadataCloud, Session } from "./metadata.ts";
import { type Bucket, bodyKey, type Pointer, pointer, pointerKey, setPointer } from "./storage.ts";

export type PendingCopy = {
  sha256: string;
  previous?: string;
  owned: boolean;
  acknowledged: boolean;
  target?: Pointer;
};

export async function sweepUncertainCopy(
  code: string,
  hash: string,
  deps: {
    bucket: Bucket;
    session: Session;
    rawDelete(key: string): Promise<unknown>;
  },
) {
  const current = await pointer(deps.bucket, code);
  if ((!current || current.uid === deps.session.uid) && current?.meta.sha256 !== hash)
    await deps.rawDelete(bodyKey(code, hash));
}

/** Resolve uncertain pointer writes before releasing either body's storage reservation. */
export async function recoverPending(
  code: string,
  saved: PendingCopy,
  deps: {
    bucket: Bucket;
    session: Session;
    cloud: Pick<ReturnType<typeof metadataCloud>, "slots" | "release">;
    rememberPending(value: PendingCopy): Promise<void>;
    rememberUncertain(hash: string): Promise<void>;
    rawDelete(key: string): Promise<unknown>;
    revoked: boolean;
  },
) {
  let current = await pointer(deps.bucket, code);
  if (current && current.uid !== deps.session.uid) {
    if (saved.owned) throw new Error("public_artifact_access_denied");
    return current;
  }
  if (deps.revoked && current) {
    await deps.bucket.delete(pointerKey(code));
    current = undefined;
  }
  let slot: string | undefined;
  if (!saved.owned || !current) {
    slot = (await deps.cloud.slots())
      .find((item) => item.fields.code?.stringValue === code)
      ?.name.split("/")
      .at(-1);
  }
  if (!saved.owned) {
    if (!current && !slot) return;
    // Keep ownership proof if metadata release succeeds but a later cleanup step fails.
    await deps.rememberPending({ ...saved, owned: true });
  }
  if (saved.target && saved.acknowledged && !deps.revoked) {
    // A lost pointer response may still commit: roll forward the same revision, never delete its body.
    if (current?.meta.revision !== saved.target.meta.revision) await setPointer(deps.bucket, code, saved.target);
    current = saved.target;
  }
  for (const hash of new Set([saved.sha256, saved.previous])) {
    if (!hash || hash === current?.meta.sha256) continue;
    if (hash === saved.sha256 && !saved.acknowledged) {
      if (!saved.target) continue;
      await deps.rememberUncertain(hash);
      // An unacknowledged put can finish after deletion; retain its budget and sweep record.
      await deps.rawDelete(bodyKey(code, hash));
    } else await deps.bucket.delete(bodyKey(code, hash));
  }
  if (!current && slot) await deps.cloud.release(code, slot);
  return current;
}
