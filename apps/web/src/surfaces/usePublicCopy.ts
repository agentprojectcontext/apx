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

/**
 * One step to share public: the copy is prepared as soon as the dialog opens (without the widget's saved data), and
 * again when the owner switches that data on or off. Nothing is public until `commit`.
 */
export function usePublicCopy(request: Request) {
  const t = useT();
  const [source, setSource] = useState<Surface>();
  const [account, setAccount] = useState<AccountProfile>();
  const [withData, setWithData] = useState(false);
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
    // A retry after a failed connection starts over with the same choices.
    if (reload >= 0) setInvalid(false);
    setBusy(true);
    setError(undefined);
    setReview(undefined);
    const own = async (prepared: Promise<{ draft: string }>) => {
      const { draft } = await prepared;
      if (!live) return releaseReview(draft);
      owned.add(draft);
      const value = await readPreview(draft);
      if (live) setReview(value);
    };
    const load = async () => {
      if (request.draft) {
        const value = await readPreview(request.draft);
        if (live) setReview(value);
        return;
      }
      if (request.action === "revoke" && request.code)
        return own(client.call("surfaces.public_prepare", { action: "revoke", code: request.code }));
      if (!request.surface) return;
      const [value, identity] = await Promise.all([
        client.call("surfaces.get", { surface: request.surface }),
        client.call("account.get", {}),
      ]);
      if (!identity.profile) throw new Error("sign_in_required");
      if (!live) return;
      setSource(value);
      setAccount(identity.profile);
      const state_keys = withData ? Object.keys(value.state ?? {}) : [];
      await own(
        request.action === "update" && request.code
          ? client.call("surfaces.public_prepare", {
              action: "update",
              code: request.code,
              surface: value.id,
              state_keys,
            })
          : client.call("surfaces.public_prepare", { action: "publish", surface: value.id, state_keys }),
      );
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
  }, [request, reload, withData]);
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
        const receipt = await client.call("surfaces.public_commit", { draft: review.draft });
        if (review.action === "revoke") notify(t("public.revoked"), "info");
        else await copyPublicLink(receipt.url, t("public.sharedCopied"), t("public.shared"));
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
  return { source, account, withData, setWithData, review, busy, error, invalid, setReload, commit };
}

/** Copies a public link and says so; when the browser refuses the clipboard, it still says the copy is public. */
async function copyPublicLink(url: string, copied: string, fallback: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify(copied, "info");
  } catch {
    notify(fallback, "info");
  }
}
