import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cpu } from "lucide-react";
import { Section } from "../Section";
import { Button, Field, Loading, Textarea, Switch } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useGlobalConfig, useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import { useIdentity } from "../../hooks/useIdentity";
import { PERMISSION_MODES } from "../../constants";
import { t } from "../../i18n";

export function SuperAgentPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { superAgent, isLoading, mutate } = useSuperAgentConfig();
  const { patch } = useGlobalConfig();
  const { identity, save: saveIdentity } = useIdentity();

  const [enabled, setEnabled] = useState(true);
  const [system, setSystem] = useState("");
  const [personality, setPersonality] = useState("");
  const [perm, setPerm] = useState<string>("permiso");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!superAgent) return;
    setEnabled(!!superAgent.enabled);
    setSystem(superAgent.system || "");
    setPerm(superAgent.permission_mode || "permiso");
  }, [superAgent]);

  useEffect(() => {
    setPersonality(identity.personality || "");
  }, [identity.personality]);

  if (isLoading || !superAgent) return <Loading />;

  const submit = async () => {
    setBusy(true);
    try {
      await patch({
        "super_agent.enabled":          enabled,
        "super_agent.system":           system,
        "super_agent.permission_mode":  perm,
      }, ["super_agent.name"]);
      await saveIdentity({ personality });
      toast.success(t("settings.super_agent.saved"));
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Section title={t("settings.super_agent.title")} description={t("settings.super_agent.behavior_subtitle")}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onChange={setEnabled} label={t("settings.super_agent.enabled_label")} />
        </div>

        {/* Model lives in the Router now — single source of truth. */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("settings.super_agent.model_active")}</div>
            <div className="truncate font-mono text-xs text-muted-fg">{superAgent.model || "—"}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate("/p/0/models")}>
            <Cpu size={13} /> {t("settings.super_agent.model_configure")}
          </Button>
        </div>

        <Field label={t("settings.super_agent.permission_mode")}>
          <UiSelect value={perm} onChange={setPerm} options={PERMISSION_MODES.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label={t("settings.super_agent.personality")}>
          <Textarea rows={2} value={personality} onChange={(e) => setPersonality(e.target.value)} />
        </Field>
        <Field label={t("settings.super_agent.system")} hint={t("settings.super_agent.system_hint")}>
          <Textarea
            rows={6}
            className="font-mono text-xs"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder={t("settings.super_agent.system_ph")}
          />
        </Field>

        <Button variant="primary" loading={busy} onClick={submit}>{t("common.save")}</Button>
      </div>
    </Section>
  );
}
