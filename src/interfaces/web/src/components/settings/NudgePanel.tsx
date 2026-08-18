import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp, Info } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Empty, Field, Input, Loading, Switch } from "../ui";
import { useToast } from "../Toast";
import { useNudges, useNudgePolicy } from "../../hooks/useNudges";
import { NudgesApi, type NudgePolicy } from "../../lib/api/nudges";
import { t } from "../../i18n";
import { toneText } from "../../lib/tone";

/**
 * The interruption budget — how often APX may speak unprompted.
 *
 * Two halves that belong together: the rule, and the record of what the rule
 * let through. Showing the ledger next to the dial is the point — someone
 * deciding "is three a day too many?" needs to see the three.
 */
export function NudgePanel() {
  const toast = useToast();
  const { policy, source, isLoading, mutate } = useNudgePolicy();
  const { entries, stats, mutate: mutateLedger } = useNudges(30);

  const [draft, setDraft] = useState<NudgePolicy | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (policy) setDraft({ ...policy });
  }, [policy]);

  if (isLoading || !draft) return <Loading />;

  const save = async () => {
    setBusy(true);
    try {
      await NudgesApi.setPolicy(draft);
      await mutate();
      toast.success(t("settings.nudge.saved"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rate = async (id: string, useful: boolean) => {
    try {
      await NudgesApi.feedback(id, useful);
      await mutateLedger();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const num = (key: keyof NudgePolicy, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={0}
        value={String(draft[key] ?? 0)}
        disabled={!draft.enabled}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) || 0 })}
      />
    </Field>
  );

  const left = draft.daily_max > 0 ? Math.max(0, draft.daily_max - (stats?.today ?? 0)) : "∞";

  return (
    <div className="flex flex-col gap-4" data-testid="nudge-panel">
      <Section title={t("settings.nudge.title")} description={t("settings.nudge.subtitle")}>
        <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Info size={16} className="mt-0.5 shrink-0 opacity-70" />
          <span>
            {draft.enabled
              ? t("settings.nudge.on_hint")
                  .replace("{{sent}}", String(stats?.today ?? 0))
                  .replace("{{left}}", String(left))
              : t("settings.nudge.off_hint")}
            {source.length ? (
              <span className="ml-1 opacity-60">
                ({t("settings.nudge.source")}: {source.join(" → ")})
              </span>
            ) : null}
          </span>
        </div>

        <div className="mb-4">
          <Switch
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
            label={t("settings.nudge.enabled")}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {num("daily_max", t("settings.nudge.daily_max"), t("settings.nudge.daily_max_hint"))}
          <Field label={t("settings.nudge.quiet_hours")} hint={t("settings.nudge.quiet_hours_hint")}>
            <Input
              value={draft.quiet_hours ?? ""}
              placeholder="22:00-07:30"
              disabled={!draft.enabled}
              onChange={(e) => setDraft({ ...draft, quiet_hours: e.target.value })}
            />
          </Field>
          {num("cooldown_minutes", t("settings.nudge.cooldown"))}
          {num("project_cooldown_minutes", t("settings.nudge.project_cooldown"))}
          {num("kind_cooldown_minutes", t("settings.nudge.kind_cooldown"))}
        </div>

        <div className="mt-3">
          <Switch
            checked={draft.critical_bypasses_budget}
            onChange={(v) => setDraft({ ...draft, critical_bypasses_budget: v })}
            label={t("settings.nudge.critical_bypass")}
            disabled={!draft.enabled}
          />
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            {t("settings.nudge.critical_bypass_hint")}
          </p>
        </div>

        <div className="mt-4">
          <Button variant="primary" loading={busy} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </Section>

      <Section title={t("settings.nudge.log_title")} description={t("settings.nudge.log_subtitle")}>
        {!entries.length ? (
          <Empty>{t("settings.nudge.log_empty")}</Empty>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="nudge-log">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge>{e.kind}</Badge>
                    <span className="text-xs opacity-55">
                      {String(e.at).replace("T", " ").slice(0, 16)}
                    </span>
                    {e.bypassed_budget ? (
                      <Badge tone="warning">{t("settings.nudge.bypass")}</Badge>
                    ) : null}
                  </span>
                  <span className="mt-1 block line-clamp-2 opacity-80">{e.preview}</span>
                </span>

                {/* Rating is available for as long as the entry is on file, not
                    only in the chat where the buttons were. Retrospect is when
                    people actually notice a pattern was noise. */}
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("settings.nudge.useful")}
                    onClick={() => rate(e.id, true)}
                    className={`rounded p-1.5 transition hover:bg-muted ${
                      e.feedback?.useful === true ? toneText.emerald : "opacity-40"
                    }`}
                  >
                    <ThumbsUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("settings.nudge.noise")}
                    onClick={() => rate(e.id, false)}
                    className={`rounded p-1.5 transition hover:bg-muted ${
                      e.feedback?.useful === false ? toneText.red : "opacity-40"
                    }`}
                  >
                    <ThumbsDown size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
