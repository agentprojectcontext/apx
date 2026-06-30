import { useEffect, useMemo, useState } from "react";
import { Section } from "../Section";
import { Button, Empty, Field, Input, Loading, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { TimezoneSelect } from "../TimezoneSelect";
import { useToast } from "../Toast";
import { useIdentity } from "../../hooks/useIdentity";
import { t } from "../../i18n";
import { languageOptions } from "../../i18n/languages";
import { timezoneOptions, detectTimezone } from "../../i18n/timezones";
import type { Identity } from "../../types/daemon";

export function IdentityPanel() {
  const toast = useToast();
  const { identity, isLoading, save } = useIdentity();
  const [draft, setDraft] = useState<Identity>({});
  const [busy, setBusy] = useState(false);
  const tzOptions = useMemo(() => timezoneOptions(), []);

  // Default the timezone to the detected OS zone (e.g. Buenos Aires) when the
  // identity has none saved yet, so the field starts on a sensible pick.
  useEffect(() => {
    setDraft({ ...identity, timezone: identity?.timezone || detectTimezone() });
  }, [identity]);

  if (isLoading) return <Loading />;

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        owner_name:    draft.owner_name,
        owner_context: draft.owner_context,
        language:      draft.language,
        timezone:      draft.timezone,
      });
      toast.success(t("settings.identity.saved"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Section title={t("settings.identity.title")} description={t("settings.identity.subtitle")}>
      {!identity ? <Empty>{t("common.none_yet")}</Empty> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("settings.identity.owner_name")}>
          <Input value={draft.owner_name || ""} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} />
        </Field>
        <Field label={t("settings.identity.language")}>
          <UiSelect
            value={draft.language || "es"}
            onChange={(v) => setDraft({ ...draft, language: v })}
            options={languageOptions()}
          />
        </Field>
        <Field label={t("settings.identity.timezone")} hint={t("settings.identity.timezone_hint")}>
          <TimezoneSelect
            value={draft.timezone || detectTimezone()}
            onChange={(v) => setDraft({ ...draft, timezone: v })}
            options={tzOptions}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t("settings.identity.owner_context")} hint={t("settings.identity.owner_context_hint")}>
          <Textarea
            rows={3}
            value={draft.owner_context || ""}
            onChange={(e) => setDraft({ ...draft, owner_context: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Button variant="primary" loading={busy} onClick={submit}>{t("common.save")}</Button>
      </div>
    </Section>
  );
}
