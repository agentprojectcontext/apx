import type { Result } from "@apx/protocol";
import { Button, Dialog, Field, Textarea } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { createThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

import { type AcceptProposal, PromptProposal } from "./PromptProposal.tsx";
import type { AgentDraft } from "./prompt-proposal.ts";

type Review = Result<"projects.helper_review">;
const report = (e: unknown) => notify(e instanceof Error ? e.message : String(e), "error");

export function ProjectHelper({ project }: { project: string }) {
  const t = useT();
  const [review, setReview] = useState<Review>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    client
      .call("projects.helper_review", { project })
      .then((r) => {
        if (live) setReview(r);
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [project]);
  return (
    <section className="overview__block">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("helper.review")}
      </Button>
      {review?.offer && <p>{t("helper.offer")}</p>}
      {open && <HelperDialog project={project} onClose={() => setOpen(false)} onChanged={setReview} />}
    </section>
  );
}

export function HelperDialog({
  project,
  draft,
  onAccept,
  onClose,
  onChanged,
}: {
  project: string;
  draft?: { role: string; prompt: string };
  onAccept?: AcceptProposal;
  onClose(): void;
  onChanged?(review: Review): void;
}) {
  const t = useT();
  const [review, setReview] = useState<Review>();
  const [reviewedDraft, setReviewedDraft] = useState<AgentDraft>();
  const handoff = useRef<{ id: string; sent: boolean } | undefined>(undefined);
  const [goal, setGoal] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setReview(undefined);
    setReviewedDraft(undefined);
    client
      .call("projects.helper_review", { project, manual: true, ...(draft ? { draft } : {}) })
      .then((r) => {
        if (live) {
          setReview(r);
          setReviewedDraft(draft ? { ...draft } : undefined);
          setGoal(r.goal);
          setResult(r.first_result);
        }
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [project, draft]);
  const close = async () => {
    if (!review || busy) return onClose();
    setBusy(true);
    try {
      await client.call("projects.helper_set", { project, dismissed: review.fingerprint });
      onChanged?.({ ...review, offer: false });
      onClose();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const prepare = async (start: boolean) => {
    setBusy(true);
    try {
      await client.call("projects.helper_set", { project, goal, first_result: result });
      const next = await client.call("projects.helper_review", { project, manual: true, ...(draft ? { draft } : {}) });
      setReview(next);
      setReviewedDraft(draft ? { ...draft } : undefined);
      onChanged?.(next);
      if (start && next.recipient) {
        if (!handoff.current) {
          const thread = await createThread({ agentId: next.recipient, projectId: project, title: t("helper.review") });
          handoff.current = { id: thread.id, sent: false };
        }
        if (!handoff.current.sent) {
          await client.call("threads.send", { thread: handoff.current.id, text: next.brief, mode: "queue" });
          handoff.current.sent = true;
        }
        await client.call("projects.helper_set", { project, dismissed: next.fingerprint });
        onClose();
        go.project(project, "chats", handoff.current.id);
      }
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    if (!review) return;
    setBusy(true);
    try {
      await client.call("projects.helper_set", { project, enabled: !review.enabled });
      const next = { ...review, enabled: !review.enabled, offer: false };
      setReview(next);
      onChanged?.(next);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={t("helper.review")}
      description={t("helper.body")}
      onOpenChange={(o) => !o && !busy && void close()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => void close()}>
            {t("common.close")}
          </Button>
          <Button variant="secondary" disabled={!review || busy} onClick={() => void prepare(false)}>
            {t("helper.prepare")}
          </Button>
          {!draft && (
            <Button disabled={!review?.recipient} loading={busy} onClick={() => void prepare(true)}>
              {t("helper.start")}
            </Button>
          )}
        </>
      }
    >
      {review && (
        <HelperFields
          review={review}
          expected={reviewedDraft}
          goal={goal}
          result={result}
          busy={busy}
          setGoal={setGoal}
          setResult={setResult}
          toggle={toggle}
          onAccept={onAccept}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function HelperFields({
  review,
  expected,
  goal,
  result,
  busy,
  setGoal,
  setResult,
  toggle,
  onAccept,
  onClose,
}: {
  review: Review;
  expected: AgentDraft | undefined;
  goal: string;
  result: string;
  busy: boolean;
  setGoal(v: string): void;
  setResult(v: string): void;
  toggle(): Promise<void>;
  onAccept?: AcceptProposal | undefined;
  onClose(): void;
}) {
  const t = useT();
  return (
    <div className="taskform">
      <Button variant="secondary" disabled={busy} onClick={() => void toggle()}>
        {review.enabled ? t("helper.turnOff") : t("helper.turnOn")}
      </Button>
      {review.missing.length === 0 && review.agent_gaps.length === 0 && <p>{t("helper.ready")}</p>}
      {review.agent_gaps.map((a) => (
        <p key={a.id}>
          {a.name}: {a.missing.map((gap) => t(`helper.gap.${gap}`)).join(", ")}
        </p>
      ))}
      {review.missing.includes("goal") && (
        <Field label={t("helper.goal")}>
          {(id) => <Textarea id={id} value={goal} maxLength={2000} onChange={(e) => setGoal(e.currentTarget.value)} />}
        </Field>
      )}
      {review.missing.includes("first_result") && (
        <Field label={t("helper.firstResult")}>
          {(id) => (
            <>
              <div>
                {(["plan", "prototype", "audit"] as const).map((key) => (
                  <Button key={key} variant="secondary" onClick={() => setResult(t(`helper.option.${key}`))}>
                    {t(`helper.option.${key}`)}
                  </Button>
                ))}
              </div>
              <Textarea id={id} value={result} maxLength={2000} onChange={(e) => setResult(e.currentTarget.value)} />
            </>
          )}
        </Field>
      )}
      {review.missing.includes("role") && <p>{t("helper.roleMissing")}</p>}
      <pre style={{ whiteSpace: "pre-wrap" }}>{review.brief}</pre>
      {review.suggested_prompt && expected && onAccept && (
        <PromptProposal
          proposed={review.suggested_prompt}
          expected={expected}
          disabled={busy}
          onAccept={onAccept}
          onApplied={onClose}
        />
      )}
    </div>
  );
}
