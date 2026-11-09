import type { ActivityReviewSettings, ActivityReviewStatus } from "@apx/protocol";
import { ApxError, ErrorCode } from "@apx/protocol/client";
import { Button, SegmentedControl, SettingRow, Skeleton, Switch, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { usePack, useT } from "../i18n/index.ts";
import { SectionHead } from "./SectionHead.tsx";

export function ActivityReviewSection() {
  return usePack("activityReview") ? <ActivityReview /> : <Skeleton height={180} shape="block" />;
}

function ActivityReview() {
  const t = useT();
  const [status, setStatus] = useState<ActivityReviewStatus>();
  const [draft, setDraft] = useState<ActivityReviewSettings>();
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setError(false);
    setConflict(false);
    setSaved(false);
    void client.call("activity_review.settings", {}).then(
      (value) => {
        setStatus(value);
        setDraft(value.settings);
      },
      () => setError(true),
    );
  };
  useEffect(load, []);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(false);
    try {
      const value = await client.call("activity_review.configure", { ...draft, expected: status?.settings });
      setStatus(value);
      setDraft(value.settings);
      setSaved(true);
    } catch (e) {
      setConflict(e instanceof ApxError && e.code === ErrorCode.Conflict);
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionHead title={t("review.title")} lead={t("review.lead")} />
      {error && (
        <p role="alert" className="config__lead">
          {t(conflict ? "review.conflict" : draft ? "review.saveError" : "review.loadError")}
        </p>
      )}
      {conflict && <Button onClick={load}>{t("review.reload")}</Button>}
      {saved && JSON.stringify(draft) === JSON.stringify(status?.settings) && (
        <p role="status" className="config__lead">
          {t("review.saved")}
        </p>
      )}
      {!draft ? (
        error ? (
          <Button onClick={load}>{t("review.retry")}</Button>
        ) : (
          <Skeleton height={180} shape="block" />
        )
      ) : (
        <>
          <SettingRow title={t("review.enabled")} description={t("review.cost")}>
            <Switch
              size="sm"
              aria-label={t("review.enabled")}
              checked={draft.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            />
          </SettingRow>
          <SettingRow title={t("review.frequency")} description={t("review.interval")}>
            <SegmentedControl
              size="sm"
              label={t("review.frequency")}
              value={draft.frequency}
              disabled={!draft.enabled || busy}
              options={[
                { value: "daily", label: t("review.daily") },
                { value: "weekly", label: t("review.weekly") },
              ]}
              onValueChange={(value) => setDraft({ ...draft, frequency: value === "weekly" ? "weekly" : "daily" })}
            />
          </SettingRow>
          <SettingRow stacked title={t("review.details")} description={t("review.detailsHint")}>
            <Textarea
              aria-label={t("review.details")}
              value={draft.extra_details}
              maxLength={2000}
              rows={4}
              disabled={!draft.enabled || busy}
              onChange={(e) => setDraft({ ...draft, extra_details: e.currentTarget.value })}
            />
          </SettingRow>
          <p className="config__lead">{t("review.proposalOnly")}</p>
          {status && !status.available && (
            <p role="status" className="config__lead">
              {t("review.unavailable")}
            </p>
          )}
          <Button
            loading={busy}
            disabled={busy || JSON.stringify(draft) === JSON.stringify(status?.settings)}
            onClick={() => void save()}
          >
            {t("review.save")}
          </Button>
        </>
      )}
    </>
  );
}
