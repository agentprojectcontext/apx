import type { Result } from "@apx/protocol";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import type { AgentDraft } from "./prompt-proposal.ts";

type Review = Result<"projects.helper_review">;

/** The draft review's two actions: keep the goal typed and review again, or close it (it stops being offered). */
export function useHelperActions({
  project,
  draft,
  goal,
  result,
  review,
  onReview,
  onClose,
}: {
  project: string;
  draft: AgentDraft;
  goal: string;
  result: string;
  review: Review | undefined;
  onReview(review: Review): void;
  onClose(): void;
}) {
  const lifetime = useRef<{ live: boolean } | undefined>(undefined);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new project or draft starts a new lifetime.
  useEffect(() => {
    const scope = { live: true };
    lifetime.current = scope;
    pending.current = false;
    setBusy(false);
    return () => {
      scope.live = false;
    };
  }, [project, draft]);

  const perform = async (action: (live: () => boolean) => Promise<void>) => {
    const scope = lifetime.current;
    if (!scope?.live || pending.current) return;
    pending.current = true;
    setBusy(true);
    const live = () => scope.live && lifetime.current === scope;
    try {
      await action(live);
    } catch (e) {
      if (live()) notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      if (live()) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const prepare = () =>
    perform(async (live) => {
      await client.call("projects.helper_set", { project, goal, first_result: result });
      if (!live()) return;
      const next = await client.call("projects.helper_review", { project, manual: true, draft });
      if (live()) onReview(next);
    });
  const close = () => {
    if (pending.current) return Promise.resolve();
    if (!review) {
      onClose();
      return Promise.resolve();
    }
    return perform(async (live) => {
      await client.call("projects.helper_set", { project, dismissed: review.fingerprint });
      if (!live()) return;
      onReview({ ...review, offer: false });
      onClose();
    });
  };
  return { busy, prepare, close };
}
