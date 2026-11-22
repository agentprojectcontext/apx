import type { DiscoverySettings, Project, Routine } from "@apx/protocol";
import { Button, Checkbox, Disclosure, Input, Select, SettingRow, Switch, TagInput } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { scheduleText } from "../routines/scheduleText.ts";
import { go } from "../shell/nav.ts";
import { DiscoverySources } from "./DiscoverySources.tsx";
import { SubHead } from "./SectionHead.tsx";

type Fields = { draft: DiscoverySettings; set: (patch: Partial<DiscoverySettings>) => void; projects: Project[] };
function DiscoveryScope({ draft, set, projects }: Fields) {
  const t = useT();
  return (
    <>
      <SubHead>{t("discovery.projects")}</SubHead>
      <Select
        label={t("discovery.projects")}
        value={draft.projects}
        options={[
          { value: "all", label: t("discovery.all") },
          { value: "selected", label: t("discovery.selected") },
        ]}
        onValueChange={(value) => set({ projects: value === "selected" ? "selected" : "all" })}
      />
      {draft.projects === "selected" && (
        <div className="discovery__choices">
          {projects.map((project) => (
            <Checkbox
              key={project.id}
              label={project.name}
              checked={draft.project_ids.includes(project.id)}
              onCheckedChange={(checked) =>
                set({
                  project_ids: checked
                    ? [...draft.project_ids, project.id]
                    : draft.project_ids.filter((id) => id !== project.id),
                })
              }
            />
          ))}
          {!draft.project_ids.length && <p className="config__lead">{t("discovery.noProjects")}</p>}
        </div>
      )}
      <SubHead>{t("discovery.sources")}</SubHead>
      <div className="discovery__choices">
        <Checkbox
          label={t("discovery.context")}
          checked={draft.project_context}
          onCheckedChange={(project_context) => set({ project_context })}
        />
        <Checkbox
          label={t("discovery.websites")}
          checked={draft.project_websites}
          onCheckedChange={(project_websites) => set({ project_websites })}
        />
        <Checkbox
          label={t("discovery.news")}
          checked={draft.interest_news}
          onCheckedChange={(interest_news) => set({ interest_news })}
        />
      </div>
      <SettingRow stacked title={t("discovery.interests")} description={t("discovery.publicTerms")}>
        <TagInput
          label={t("discovery.interests")}
          placeholder={t("discovery.addInterest")}
          value={draft.interests}
          max={30}
          onValueChange={(interests) => set({ interests })}
        />
      </SettingRow>
      {!draft.interests.length && <p className="config__lead">{t("discovery.emptyInterests")}</p>}
      <SettingRow stacked title={t("discovery.place")} description={t("discovery.placeHint")}>
        <Input
          aria-label={t("discovery.place")}
          placeholder={t("discovery.city")}
          maxLength={120}
          value={draft.location}
          onChange={(e) => set({ location: e.currentTarget.value })}
        />
      </SettingRow>
    </>
  );
}

export function DiscoveryForm({
  draft,
  change,
  projects,
  routines,
}: {
  draft: DiscoverySettings;
  change: (settings: DiscoverySettings) => void;
  projects: Project[];
  routines: Routine[];
}) {
  const t = useT();
  const set = (patch: Partial<DiscoverySettings>) => change({ ...draft, ...patch });
  const report = routines.find((r) => r.id === draft.report_routine);
  const zones = [...new Set([draft.timezone, "UTC", ...Intl.supportedValuesOf("timeZone")])];
  return (
    <>
      <SettingRow title={t("discovery.enabled")} description={t("discovery.cost")}>
        <Switch
          size="sm"
          checked={draft.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          aria-label={t("discovery.enabled")}
        />
      </SettingRow>
      <DiscoveryScope draft={draft} set={set} projects={projects} />
      <SettingRow title={t("discovery.frequency")} description={t("discovery.scan")}>
        <Select
          label={t("discovery.frequency")}
          value={String(draft.deep_every_days)}
          options={Array.from({ length: 14 }, (_, i) => ({
            value: String(i + 1),
            label: i ? t("discovery.days", { count: i + 1 }) : t("discovery.daily"),
          }))}
          onValueChange={(value) => set({ deep_every_days: Number(value) })}
        />
      </SettingRow>
      <SettingRow title={t("discovery.timezone")}>
        <Select
          label={t("discovery.timezone")}
          value={draft.timezone}
          options={zones.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ").replaceAll("/", " / ") }))}
          onValueChange={(timezone) => timezone && set({ timezone })}
        />
      </SettingRow>
      <SettingRow stacked title={t("discovery.report")} description={t("discovery.reportHint")}>
        <Select
          label={t("discovery.report")}
          value={draft.report_routine ?? ""}
          options={[
            { value: "", label: t("discovery.noReport") },
            ...routines.map((r) => ({
              value: r.id,
              label: r.name,
              description: scheduleText(r.schedule, t),
              disabled: !r.enabled,
            })),
          ]}
          onValueChange={(id) => set({ report_routine: id || null })}
        />
      </SettingRow>
      {report && <p className="config__lead">{scheduleText(report.schedule, t)}</p>}
      <Button
        variant="ghost"
        onClick={() => {
          go.config(null);
          go.view("routines");
        }}
      >
        {t("discovery.setupReport")}
      </Button>
      <div className="discovery__stack">
        <Disclosure title={t("discovery.limits")}>
          {(
            [
              ["max_model_calls", "discovery.calls", 1, 20],
              ["max_pages", "discovery.pages", 2, 40],
              ["max_seconds", "discovery.seconds", 30, 600],
              ["cooldown_days", "discovery.cooldown", 1, 90],
            ] as const
          ).map(([field, label, min, max]) => (
            <SettingRow key={field} title={t(label)}>
              <Input
                required
                type="number"
                min={min}
                max={max}
                step={1}
                value={String(draft[field])}
                aria-label={t(label)}
                onChange={(e) => set({ [field]: Number(e.currentTarget.value) })}
              />
            </SettingRow>
          ))}
        </Disclosure>
        <DiscoverySources value={draft.sources} projects={projects} change={(sources) => set({ sources })} />
      </div>
    </>
  );
}
