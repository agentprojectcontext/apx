import type { AccountProfile, Surface } from "@apx/protocol";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { publicError } from "./publicErrors.ts";
import { closePublicCopy, type usePublicRequest } from "./publicRequest.ts";

type Review = Awaited<ReturnType<typeof readPreview>>;
const readPreview = (draft: string) => client.call("surfaces.public_preview", { draft });
type Request = NonNullable<ReturnType<typeof usePublicRequest>>;
const releaseReview = (draft: string) => {
  void client.call("surfaces.public_discard", { draft }).catch(() => {});
};

export function usePublicCopy(request: Request) {
  const t = useT();
  const [source, setSource] = useState<Surface>();
  const [account, setAccount] = useState<AccountProfile>();
  const [keys, setKeys] = useState<string[]>([]);
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<MessageKey>();
  const [invalid, setInvalid] = useState(false);
  const [reload, setReload] = useState(0);
  const ownedDrafts = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const owned = new Set<string>();
    ownedDrafts.current = owned;
    if (reload > 0) setInvalid(false);
    setBusy(true);
    setError(undefined);
    const load = async () => {
      if (request.draft) {
        const value = await readPreview(request.draft);
        if (live) setReview(value);
      } else if (request.action === "revoke" && request.code) {
        const draft = await client.call("surfaces.public_prepare", { action: "revoke", code: request.code });
        if (!live) return releaseReview(draft.draft);
        owned.add(draft.draft);
        const value = await readPreview(draft.draft);
        if (live) setReview(value);
      } else if (request.surface) {
        const [value, identity] = await Promise.all([
          client.call("surfaces.get", { surface: request.surface }),
          client.call("account.get", {}),
        ]);
        if (!identity.profile) throw new Error("sign_in_required");
        if (live) {
          setSource(value);
          setAccount(identity.profile);
        }
      }
    };
    void load()
      .catch((e: unknown) => {
        if (live) setError(publicError(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      if (ownedDrafts.current === owned) ownedDrafts.current = undefined;
      for (const draft of owned) releaseReview(draft);
    };
  }, [request, reload]);
  const prepare = async () => {
    const owned = ownedDrafts.current;
    if (!source || request.action === "revoke" || !owned) return;
    setBusy(true);
    setError(undefined);
    try {
      const result =
        request.action === "update" && request.code
          ? await client.call("surfaces.public_prepare", {
              action: "update",
              code: request.code,
              surface: source.id,
              state_keys: keys,
            })
          : await client.call("surfaces.public_prepare", { action: "publish", surface: source.id, state_keys: keys });
      if (ownedDrafts.current !== owned) return releaseReview(result.draft);
      owned.add(result.draft);
      const value = await readPreview(result.draft);
      if (ownedDrafts.current === owned) setReview(value);
    } catch (e) {
      if (ownedDrafts.current === owned) setError(publicError(e));
    } finally {
      if (ownedDrafts.current === owned) setBusy(false);
    }
  };
  const commit = async () => {
    if (!review || invalid) return;
    setBusy(true);
    setError(undefined);
    try {
      if (request.input)
        await client.call("runs.respond", {
          input: request.input,
          decision: "approve",
          artifact_review: review.review_token,
        });
      else {
        await client.call("surfaces.public_commit", { draft: review.draft });
        notify(
          t(
            review.action === "revoke"
              ? "public.revoked"
              : review.action === "update"
                ? "public.updated"
                : "public.published",
          ),
          "info",
        );
      }
      ownedDrafts.current?.delete(review.draft);
      window.dispatchEvent(new Event("apx-public-copies-changed"));
      closePublicCopy();
    } catch (e) {
      const key = publicError(e);
      setError(key);
      if (key === "public.invalid" || key === "public.signIn") setInvalid(true);
    } finally {
      setBusy(false);
    }
  };
  const back = async () => {
    if (!review || request.draft) return;
    setBusy(true);
    try {
      await client.call("surfaces.public_discard", { draft: review.draft });
      ownedDrafts.current?.delete(review.draft);
      setReview(undefined);
      setError(undefined);
      setInvalid(false);
    } catch (e) {
      setError(publicError(e));
    } finally {
      setBusy(false);
    }
  };
  return { source, account, keys, setKeys, review, busy, error, invalid, setReload, prepare, commit, back };
}
