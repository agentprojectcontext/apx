import type { DiscoverySettings, Project, Routine } from "@apx/protocol";
import { Button, Checkbox, Disclosure, Input, Select, SettingRow, TagInput } from "@apx/ui";
import { zonePlace } from "../common/pickers/LocaleSelect.tsx";
import { useT } from "../i18n/index.ts";
import { scheduleText } from "../routines/scheduleText.ts";
import { go } from "../shell/nav.ts";
import { DiscoverySources } from "./DiscoverySources.tsx";
import { SubHead } from "./SectionHead.tsx";

type Fields = { draft: DiscoverySettings; set: (patch: Partial<DiscoverySettings>) => void };

/** Where the finding arrives: the report it joins, and the time zone that decides its day. */
function DiscoveryDelivery({
  draft,
  set,
  reports,
  zone,
}: Fields & { reports: Routine[]; zone: { value: string; mine: boolean } }) {
  const t = useT();
  const report = reports.find((r) => r.id === draft.report_routine);
  return (
    <>
      <SubHead>{t("discovery.where")}</SubHead>
      <SettingRow
        stacked
        title={t("discovery.report")}
        description={
          report
            ? t("discovery.reportWhen", { when: scheduleText(report.schedule, t) })
            : reports.length
              ? t("discovery.reportHint")
              : t("discovery.noReports")
        }
      >
        <div className="discovery__inline">
          {!!reports.length && (
            <Select
              label={t("discovery.report")}
              value={draft.report_routine ?? ""}
              options={[
                { value: "", label: t("discovery.noReport") },
                ...reports.map((r) => ({
                  value: r.id,
                  label: r.name,
                  description: scheduleText(r.schedule, t),
                  disabled: !r.enabled,
                })),
              ]}
              onValueChange={(id) => set({ report_routine: id || null })}
            />
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              go.config(null);
              go.view("routines");
            }}
          >
            {t(reports.length ? "discovery.setupReport" : "discovery.createReport")}
          </Button>
        </div>
      </SettingRow>
      <SettingRow
        title={t("discovery.timezone")}
        description={t(zone.mine ? "discovery.zoneMine" : "discovery.zoneNone", { zone: zonePlace(zone.value) })}
      >
        <Button size="sm" variant="secondary" onClick={() => go.config("account")}>
          {t("discovery.zoneChange")}
        </Button>
      </SettingRow>
    </>
  );
}

function DiscoveryScope({ draft, set, projects }: Fields & { projects: Project[] }) {
  const t = useT();
  return (
    <>
      <SubHead>{t("discovery.what")}</SubHead>
      <SettingRow stacked title={t("discovery.projects")}>
        <Select
          label={t("discovery.projects")}
          value={draft.projects}
          options={[
            { value: "all", label: t("discovery.all") },
            { value: "selected", label: t("discovery.selected") },
          ]}
          onValueChange={(value) => set({ projects: value === "selected" ? "selected" : "all" })}
        />
      </SettingRow>
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
      <SettingRow stacked title={t("discovery.interests")} description={t("discovery.interestsHint")}>
        <TagInput
          label={t("discovery.interests")}
          placeholder={t("discovery.addInterest")}
          addLabel={t("discovery.add")}
          removeLabel={t("discovery.removeInterest")}
          value={draft.interests}
          max={30}
          onValueChange={(interests) => set({ interests })}
        />
      </SettingRow>
      <SettingRow stacked title={t("discovery.place")} description={t("discovery.placeHint")}>
        <Input
          aria-label={t("discovery.place")}
          placeholder={t("discovery.city")}
          maxLength={120}
          value={draft.location}
          onChange={(e) => set({ location: e.currentTarget.value })}
        />
      </SettingRow>
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
    </>
  );
}

/** The research setup, kept as a draft until Save: saving restarts the research with the new choices. */
export function DiscoveryForm({
  draft,
  change,
  projects,
  reports,
  zone,
}: {
  draft: DiscoverySettings;
  change: (settings: DiscoverySettings) => void;
  projects: Project[];
  reports: Routine[];
  zone: { value: string; mine: boolean };
}) {
  const t = useT();
  const set = (patch: Partial<DiscoverySettings>) => change({ ...draft, ...patch });
  return (
    <>
      <DiscoveryDelivery draft={draft} set={set} reports={reports} zone={zone} />
      <DiscoveryScope draft={draft} set={set} projects={projects} />
      <SubHead>{t("discovery.howOften")}</SubHead>
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
      <div className="discovery__stack">
        <Disclosure title={t("discovery.limits")}>
          {(
            [
              ["max_model_calls", "discovery.calls", 3, 20],
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
