import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useProfiles, useProfile, useProfileDoctor } from "../../hooks/useProfiles";
import { ProfilesApi, type ProfileSchemaProp } from "../../lib/api/profiles";
import { t } from "../../i18n";

/**
 * Agent profiles — an installable line of work for the super-agent.
 *
 * Not to be confused with the agent's persona (its visible name, under
 * Identity), nor with configuration profiles. With none active, APX behaves
 * exactly as it always has, and the panel says so rather than looking broken.
 */
export function ProfilePanel() {
  const toast = useToast();
  const { active, profiles, isLoading, mutate } = useProfiles();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const currentId = selectedId ?? active ?? profiles[0]?.id ?? null;
  const { profile, mutate: mutateProfile } = useProfile(currentId);
  const { doctor, mutate: mutateDoctor } = useProfileDoctor(active);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(profile.config || {})) next[k] = String(v ?? "");
    setDraft(next);
  }, [profile?.id, profile?.config]);

  const refreshAll = async () => {
    await Promise.all([mutate(), mutateProfile(), mutateDoctor()]);
  };

  if (isLoading) return <Loading />;

  const activate = async (id: string, force: boolean) => {
    setBusy(true);
    try {
      const r = await ProfilesApi.use(id, force);
      for (const w of r.warnings || []) toast.error(w);
      await refreshAll();
      toast.success(t("settings.profile.activated"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await ProfilesApi.off();
      await refreshAll();
      toast.success(t("settings.profile.deactivated"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  };

  const saveConfig = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const r = await ProfilesApi.setConfig(draft, profile.id);
      await refreshAll();
      const moved = r.routines?.installed?.length ?? 0;
      toast.success(
        moved > 0 ? t("settings.profile.saved_with_routines") : t("settings.profile.saved"),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const props: Record<string, ProfileSchemaProp> = profile?.schema?.properties || {};
  const overBudget = !!profile?.budget && !!profile?.tokens && profile.tokens > profile.budget;

  // Settings are editable only for the ACTIVE profile — changing them
  // reschedules its routines, which is meaningless for one that is not running.
  const canEdit = !!profile?.active;

  return (
    <div className="flex flex-col gap-4" data-testid="profile-panel">
      <Section
        title={t("settings.profile.title")}
        description={t("settings.profile.subtitle")}
      >
        {/* Always rendered, in both states. A banner that only appears when
            inactive would push every card below it down the moment you
            activate — the exact reflow this layout is built to avoid. */}
        <div
          data-testid="profile-vanilla-hint"
          className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
        >
          <Info size={16} className="mt-0.5 shrink-0 opacity-70" />
          <span>
            {active ? t("settings.profile.active_hint") : t("settings.profile.vanilla_hint")}
          </span>
        </div>

        {!profiles.length ? (
          <Empty>{t("settings.profile.none_available")}</Empty>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {profiles.map((p) => (
              <button
                key={p.id}
                data-testid={`profile-row-${p.id}`}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`flex items-start justify-between gap-3 rounded-md border p-3 text-left transition ${
                  p.id === currentId ? "border-primary bg-muted/40" : "border-border hover:bg-muted/20"
                }`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge>{p.source}</Badge>
                    {p.active ? <Badge tone="success">{t("settings.profile.active")}</Badge> : null}
                  </span>
                  {p.description ? (
                    <span className="mt-0.5 block text-sm opacity-70">{p.description}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs opacity-60">{p.version ? `v${p.version}` : ""}</span>
              </button>
            ))}
          </div>
        )}

        {profile ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {profile.active ? (
              <Button variant="destructive" loading={busy} onClick={() => setConfirmOff(true)}>
                {t("settings.profile.deactivate")}
              </Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={() => activate(profile.id, !!active)}>
                {active ? t("settings.profile.replace_active") : t("settings.profile.activate")}
              </Button>
            )}
            <span className="text-xs opacity-60">
              {t("settings.profile.token_cost")}: ~{profile.tokens ?? 0}
              {profile.budget ? ` / ${profile.budget}` : ""}
              {overBudget ? ` — ${t("settings.profile.over_budget")}` : ""}
            </span>
          </div>
        ) : null}
      </Section>

      {/* Settings, Doctor and the prompt block are ALWAYS mounted, in the same
          places, whether or not a profile is active. Activating one must not
          make cards appear and push the rest of the page down — a layout that
          reflows under you is disorienting, and it hides the fact that the
          prompt block is the thing that just changed. Inactive simply means
          disabled. */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Section
          title={t("settings.profile.settings_title")}
          description={t("settings.profile.settings_subtitle")}
        >
          {!Object.keys(props).length ? (
            <Empty>{t("settings.profile.no_settings")}</Empty>
          ) : (
            <>
              {!canEdit ? (
                <p className="mb-3 text-sm opacity-60">{t("settings.profile.settings_locked")}</p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(props).map(([key, def]) => (
                  <Field key={key} label={def.title || key} hint={def.description}>
                    {def.enum ? (
                      <UiSelect
                        value={draft[key] ?? String(def.default ?? "")}
                        onChange={(v) => setDraft({ ...draft, [key]: v })}
                        options={def.enum.map((o) => ({ value: String(o), label: String(o) }))}
                        disabled={!canEdit}
                      />
                    ) : (
                      <Input
                        value={draft[key] ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </div>
              <div className="mt-4">
                <Button variant="primary" loading={busy} disabled={!canEdit} onClick={saveConfig}>
                  {t("common.save")}
                </Button>
              </div>
            </>
          )}
        </Section>

        <div className="flex flex-col gap-4">
          <Section title={t("settings.profile.doctor_title")} description={doctor?.summary || ""}>
            {!doctor?.checks?.length ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 size={16} className="text-emerald-500" />
                {active ? t("settings.profile.doctor_clean") : t("settings.profile.doctor_vanilla")}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {doctor.checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle
                      size={16}
                      className={`mt-0.5 shrink-0 ${c.level === "error" ? "text-red-500" : "text-amber-500"}`}
                    />
                    <span className="min-w-0">
                      <span className="opacity-60">[{c.label}]</span> {c.detail}
                      {c.fix ? (
                        <code className="mt-1 block overflow-x-auto rounded bg-muted px-1.5 py-0.5 text-xs">
                          {c.fix}
                        </code>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={t("settings.profile.preview_title")}
            description={
              profile?.active
                ? t("settings.profile.preview_subtitle")
                : t("settings.profile.preview_inactive")
            }
          >
            <pre
              data-testid="profile-preview"
              className={`max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed ${
                profile?.active ? "" : "opacity-60"
              }`}
            >
              {profile?.preview || t("settings.profile.preview_empty")}
            </pre>
          </Section>
        </div>
      </div>

      <Dialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title={t("settings.profile.deactivate_title")}
        footer={
          <>
            <Button onClick={() => setConfirmOff(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" loading={busy} onClick={deactivate}>
              {t("settings.profile.deactivate")}
            </Button>
          </>
        }
      >
        {t("settings.profile.deactivate_confirm")}
      </Dialog>
    </div>
  );
}
