import type { Result } from "@apx/protocol";
import { secureRequestKey } from "@apx/protocol/client";
import { useEffect, useRef, useState } from "react";
import { createThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { go } from "../shell/nav.ts";
import type { AgentDraft } from "./prompt-proposal.ts";

type Review = Result<"projects.helper_review">;
type Handoff = {
  createKey: string;
  sendKey: string;
  project: string;
  recipient: string;
  title: string;
  text: string;
  fingerprint: string;
  id?: string;
  sent?: boolean;
};

export function useHelperActions({
  project,
  draft,
  goal,
  result,
  review,
  title,
  onReview,
  onClose,
}: {
  project: string;
  draft: AgentDraft | undefined;
  goal: string;
  result: string;
  review: Review | undefined;
  title: string;
  onReview(review: Review): void;
  onClose(): void;
}) {
  const lifetime = useRef<{ live: boolean; project: string; draft: AgentDraft | undefined } | undefined>(undefined);
  const pending = useRef(false);
  const handoff = useRef<Handoff | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const scope = { live: true, project, draft };
    lifetime.current = scope;
    pending.current = false;
    handoff.current = undefined;
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
  const send = async (item: Handoff, live: () => boolean) => {
    if (!item.id) {
      const thread = await createThread(
        { agentId: item.recipient, projectId: item.project, title: item.title },
        item.createKey,
      );
      item.id = thread.id;
    }
    if (!live()) return;
    if (!item.sent) {
      await client.call("threads.send", { thread: item.id, text: item.text, mode: "queue" }, item.sendKey);
      item.sent = true;
    }
    if (!live()) return;
    await client.call("projects.helper_set", { project: item.project, dismissed: item.fingerprint });
    if (!live()) return;
    onClose();
    go.project(item.project, "chats", item.id);
  };
  const prepare = (start: boolean) =>
    perform(async (live) => {
      if (handoff.current) {
        if (start) await send(handoff.current, live);
        return;
      }
      await client.call("projects.helper_set", { project, goal, first_result: result });
      if (!live()) return;
      const next = await client.call("projects.helper_review", { project, manual: true, ...(draft ? { draft } : {}) });
      if (!live()) return;
      onReview(next);
      if (start && next.recipient) {
        // A retry reuses both payload and keys, even if the core accepted a request whose response was lost.
        handoff.current = {
          createKey: secureRequestKey(),
          sendKey: secureRequestKey(),
          project,
          recipient: next.recipient,
          title,
          text: next.brief,
          fingerprint: next.fingerprint,
        };
        await send(handoff.current, live);
      }
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
  const toggle = () =>
    perform(async (live) => {
      if (!review || handoff.current) return;
      await client.call("projects.helper_set", { project, enabled: !review.enabled });
      if (live()) onReview({ ...review, enabled: !review.enabled, offer: false });
    });
  return { busy, locked: busy || Boolean(handoff.current), prepare, close, toggle };
}
