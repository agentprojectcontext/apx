import type { Result } from "@apx/protocol";
import { secureRequestKey } from "@apx/protocol/client";
import { Button, Dialog, Field, Icons, Textarea } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { askAbout } from "../surfaces/widgetChatActions.ts";
import { OverviewCard } from "./OverviewCards.tsx";
import { helperGaps } from "./overviewData.ts";
import { type AcceptProposal, PromptProposal } from "./PromptProposal.tsx";
import type { AgentDraft } from "./prompt-proposal.ts";
import { useHelperActions } from "./useHelperActions.ts";

type Review = Result<"projects.helper_review">;
const report = (e: unknown) => notify(e instanceof Error ? e.message : String(e), "error");

/**
 * The overview's card for going over the project with its lead agent (or the super-agent): what is missing, and a
 * chat that opens over the page with the first words ready for the owner to change or send.
 */
export function ProjectHelper({ project }: { project: string }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [review, setReview] = useState<Review>();
  useEffect(() => {
    let live = true;
    client
      .call("projects.helper_review", { project, manual: true })
      .then((r) => {
        if (live) setReview(r);
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [project]);
  // One chat per attempt: a retry after an error reuses the key; leaving the overview drops what comes after.
  const attempt = useRef<string | undefined>(undefined);
  const shown = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  const agent = review?.recipient ? agents[review.recipient] : undefined;
  if (!review || !agent) return null;
  const talk = async () => {
    if (busy) return;
    setBusy(true);
    attempt.current ??= secureRequestKey();
    const done = await askAbout(
      agent.id,
      project,
      { title: t("helper.chatTitle"), draft: t("helper.chatDraft") },
      { key: attempt.current, wanted: () => shown.current },
    );
    if (done) attempt.current = undefined;
    if (shown.current) setBusy(false);
  };
  const gaps = helperGaps(review).map((g) => ("name" in g ? t(g.key, { name: g.name }) : t(g.key)));
  return (
    <OverviewCard title={t("helper.title")} mark={gaps.length > 0}>
      <div className="projside__helper">
        {gaps.length > 0 && (
          <ul className="projside__gaps" aria-label={t("helper.missing")}>
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
        <p className="projside__hint">{t("helper.pitch", { name: agent.name })}</p>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.MessageCircle size={14} />}
          loading={busy}
          onClick={() => void talk()}
        >
          {t("helper.talk", { name: agent.name })}
        </Button>
      </div>
    </OverviewCard>
  );
}

/** A new agent's draft checked against the project: what it lacks, and instructions APX proposes from its goal. */
export function HelperDialog({
  project,
  draft,
  onAccept,
  onClose,
  onChanged,
}: {
  project: string;
  draft: AgentDraft;
  onAccept: AcceptProposal;
  onClose(): void;
  onChanged?(review: Review): void;
}) {
  const t = useT();
  const [review, setReview] = useState<Review>();
  const [reviewedDraft, setReviewedDraft] = useState<AgentDraft>();
  const [goal, setGoal] = useState("");
  const [result, setResult] = useState("");
  const { busy, close, prepare } = useHelperActions({
    project,
    draft,
    goal,
    result,
    review,
    onClose,
    onReview: (next) => {
      setReview(next);
      setReviewedDraft({ ...draft });
      onChanged?.(next);
    },
  });
  useEffect(() => {
    let live = true;
    setReview(undefined);
    setReviewedDraft(undefined);
    client
      .call("projects.helper_review", { project, manual: true, draft })
      .then((r) => {
        if (live) {
          setReview(r);
          setReviewedDraft({ ...draft });
          setGoal(r.goal);
          setResult(r.first_result);
        }
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [project, draft]);
  return (
    <Dialog
      open
      title={t("helper.agentReview")}
      description={t("helper.body")}
      onOpenChange={(o) => !o && !busy && void close()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => void close()}>
            {t("common.close")}
          </Button>
          <Button disabled={!review} loading={busy} onClick={() => void prepare()}>
            {t("helper.prepare")}
          </Button>
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
  onAccept: AcceptProposal;
  onClose(): void;
}) {
  const t = useT();
  return (
    <div className="taskform">
      {review.missing.length === 0 && <p>{t("helper.ready")}</p>}
      {review.missing.includes("goal") && (
        <Field label={t("helper.goal")}>
          {(id) => (
            <Textarea
              id={id}
              disabled={busy}
              value={goal}
              maxLength={2000}
              onChange={(e) => setGoal(e.currentTarget.value)}
            />
          )}
        </Field>
      )}
      {review.missing.includes("first_result") && (
        <Field label={t("helper.firstResult")}>
          {(id) => (
            <>
              <div>
                {(["plan", "prototype", "audit"] as const).map((key) => (
                  <Button
                    key={key}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setResult(t(`helper.option.${key}`))}
                  >
                    {t(`helper.option.${key}`)}
                  </Button>
                ))}
              </div>
              <Textarea
                id={id}
                disabled={busy}
                value={result}
                maxLength={2000}
                onChange={(e) => setResult(e.currentTarget.value)}
              />
            </>
          )}
        </Field>
      )}
      {review.missing.includes("role") && <p>{t("helper.roleMissing")}</p>}
      {review.suggested_prompt && expected && (
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
