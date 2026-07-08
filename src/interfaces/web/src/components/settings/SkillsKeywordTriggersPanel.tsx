import { useState } from "react";
import useSWR from "swr";
import { Zap } from "lucide-react";
import { Section } from "../Section";
import { Field, Input, Loading, Badge, Switch } from "../ui";
import { useToast } from "../Toast";
import { Skills } from "../../lib/api/skills";
import { t } from "../../i18n";

// Keyword triggers ("option B", OpenHands-style) — the switchable alternative
// to the semantic Skill Inspector. Skills that declare `triggers:` (a keyword
// list) in their SKILL.md frontmatter get their body auto-injected when a
// keyword appears in the user's message. This card toggles the feature, tunes
// its caps, and lists every skill that declares triggers.
//
// Mirrors SkillsInspectorPanel: config persists under
// config.skills.keyword_triggers.* via PUT /skills/keyword-triggers.

export function SkillsKeywordTriggersPanel() {
  const toast = useToast();
  const { data, mutate, isLoading } = useSWR("/skills/keyword-triggers", () =>
    Skills.keywordTriggers(),
  );
  const [busy, setBusy] = useState(false);

  if (isLoading || !data) return <Loading />;

  const cfg = data.config;

  const apply = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await Skills.updateKeywordTriggers(patch);
      await mutate();
    } catch (e) {
      toast.error(t("settings_ui.could_not_save", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t("settings_ui.kw_triggers_title")}
      description={t("settings_ui.kw_triggers_desc")}
    >
      <div className="space-y-4">
        <Field
          label={t("settings_ui.enable_kw_triggers")}
          hint={t("settings_ui.enable_kw_triggers_hint")}
        >
          <Switch
            checked={cfg.enabled}
            disabled={busy}
            onChange={(v) => apply({ enabled: v })}
            label={cfg.enabled ? t("settings_ui.on") : t("settings_ui.off")}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label={t("settings_ui.kw_max_matches")} hint={t("settings_ui.kw_max_matches_hint")}>
            <Input
              type="number"
              step={1}
              min={0}
              max={5}
              defaultValue={String(cfg.max_matches)}
              disabled={busy}
              onBlur={(ev) => {
                const n = Number(ev.target.value);
                if (Number.isFinite(n) && n !== cfg.max_matches) apply({ max_matches: n });
              }}
              className="max-w-[12rem]"
            />
          </Field>
          <Field label={t("settings_ui.kw_body_char_cap")} hint={t("settings_ui.kw_body_char_cap_hint")}>
            <Input
              type="number"
              step={500}
              min={500}
              max={20000}
              defaultValue={String(cfg.body_char_cap)}
              disabled={busy}
              onBlur={(ev) => {
                const n = Number(ev.target.value);
                if (Number.isFinite(n) && n !== cfg.body_char_cap) apply({ body_char_cap: n });
              }}
              className="max-w-[12rem]"
            />
          </Field>
        </div>

        <div className="pt-1">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Zap size={14} className="text-muted-foreground" />
            {t("settings_ui.kw_skills_title")}
          </div>
          {data.skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings_ui.kw_no_skills")}</p>
          ) : (
            <div className="space-y-1.5">
              {data.skills.map((s) => (
                <div key={s.slug} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={s.enabled ? "success" : "muted"}>{s.slug}</Badge>
                  <Badge tone="muted">{s.source}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.triggers.join(", ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
