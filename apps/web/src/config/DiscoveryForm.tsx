import type { DiscoverySettings, Project, Routine } from "@apx/protocol";
import {
  Button,
  Checkbox,
  Disclosure,
  Icons,
  Input,
  Menu,
  SegmentedControl,
  Select,
  SettingRow,
  Tag,
  TagInput,
} from "@apx/ui";
import { useState } from "react";
import { zonePlace } from "../common/pickers/LocaleSelect.tsx";
import type { RoutineDraft } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { RoutineEditor } from "../routines/RoutineEditor.tsx";
import { scheduleText } from "../routines/scheduleText.ts";
import { go } from "../shell/nav.ts";
import { DiscoverySources } from "./DiscoverySources.tsx";
import { SubHead } from "./SectionHead.tsx";

type Fields = { draft: DiscoverySettings; set: (patch: Partial<DiscoverySettings>) => void };

/** A blank daily routine for the super-agent, opened in the routine editor from here. */
const blankRoutine = (agent: string): RoutineDraft => ({
  name: "",
  agent,
  schedule: { kind: "cron", cron: "0 9 * * *" },
  action: "agent",
  prompt: "",
  pre_command: "",
  post_command: "",
  call_model: "always",
  anchor: false,
  max_steps: "",
  autonomy: "",
  enabled: true,
});

/** How the owner hears about findings: on their own (urgent at once, the rest each morning), or in a routine. */
function DiscoveryDelivery({
  draft,
  set,
  reports,
  zone,
  routinesChanged,
}: Fields & { reports: Routine[]; zone: { value: string; mine: boolean }; routinesChanged: () => void }) {
  const t = useT();
  const boss = useData((s) => Object.values(s.agents).find((a) => a.kind === "secretary")?.id ?? "");
  const [creating, setCreating] = useState(false);
  const report = reports.find((r) => r.id === draft.report_routine);
  const routine = draft.delivery === "routine";
  return (
    <>
      <SubHead>{t("discovery.where")}</SubHead>
      <SettingRow
        stacked
        title={
          <SegmentedControl
            label={t("discovery.where")}
            value={draft.delivery}
            onValueChange={(v) => set({ delivery: v === "routine" ? "routine" : "automatic" })}
            options={[
              { value: "automatic", label: t("discovery.automatic") },
              { value: "routine", label: t("discovery.inRoutine") },
            ]}
          />
        }
        description={
          !routine
            ? t("discovery.automaticHint")
            : report
              ? t("discovery.routineWhen", { when: scheduleText(report.schedule, t) })
              : reports.length
                ? t("discovery.routinePick")
                : t("discovery.noRoutines")
        }
      >
        {routine && (
          <div className="discovery__inline">
            {!!reports.length && (
              <Select
                label={t("discovery.routine")}
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
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
              {t("discovery.createRoutine")}
            </Button>
          </div>
        )}
      </SettingRow>
      {creating && (
        <RoutineEditor
          draft={blankRoutine(boss)}
          onClose={() => {
            setCreating(false);
            routinesChanged();
          }}
        />
      )}
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

/** "All my projects", or the ones ticked in a menu, shown under it side by side. */
function ProjectPicker({ draft, set, projects }: Fields & { projects: Project[] }) {
  const t = useT();
  const all = draft.projects === "all";
  const picked = projects.filter((p) => draft.project_ids.includes(p.id));
  const label = all
    ? t("discovery.all")
    : picked.length === 1
      ? t("discovery.oneProject")
      : t("discovery.someProjects", { count: picked.length });
  return (
    <SettingRow stacked title={t("discovery.projects")}>
      <div className="discovery__picker">
        <Menu
          align="start"
          trigger={
            <Button variant="secondary" trailingIcon={<Icons.ChevronDown size={14} />}>
              {label}
            </Button>
          }
          items={[
            {
              label: t("discovery.all"),
              checked: all,
              keepOpen: true,
              onSelect: () => set({ projects: "all", project_ids: [] }),
            },
            { type: "separator" },
            ...projects.map((p) => {
              const on = !all && draft.project_ids.includes(p.id);
              return {
                label: p.name,
                checked: on,
                keepOpen: true,
                onSelect: () =>
                  set({
                    projects: "selected" as const,
                    project_ids: on
                      ? draft.project_ids.filter((id) => id !== p.id)
                      : [...draft.project_ids.filter((id) => projects.some((x) => x.id === id)), p.id],
                  }),
              };
            }),
          ]}
        />
        {!all && !!picked.length && (
          <div className="discovery__chips">
            {picked.map((p) => (
              <Tag key={p.id} icon={<Icons.Folder />}>
                {p.name}
              </Tag>
            ))}
          </div>
        )}
        {!all && !picked.length && <p className="config__lead">{t("discovery.noProjects")}</p>}
      </div>
    </SettingRow>
  );
}

function DiscoveryScope({ draft, set, projects }: Fields & { projects: Project[] }) {
  const t = useT();
  return (
    <>
      <SubHead>{t("discovery.what")}</SubHead>
      <ProjectPicker draft={draft} set={set} projects={projects} />
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
      <SettingRow stacked title={t("discovery.places")} description={t("discovery.placesHint")}>
        <TagInput
          label={t("discovery.places")}
          placeholder={t("discovery.city")}
          addLabel={t("discovery.add")}
          removeLabel={t("discovery.removePlace")}
          value={draft.places}
          max={10}
          onValueChange={(places) => set({ places })}
        />
      </SettingRow>
      <SubHead>{t("discovery.sources")}</SubHead>
      <p className="config__lead">{t("discovery.rhythm")}</p>
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
  routinesChanged,
}: {
  draft: DiscoverySettings;
  change: (settings: DiscoverySettings) => void;
  projects: Project[];
  reports: Routine[];
  zone: { value: string; mine: boolean };
  /** A routine was made here: the list of routines is read again. */
  routinesChanged: () => void;
}) {
  const t = useT();
  const set = (patch: Partial<DiscoverySettings>) => change({ ...draft, ...patch });
  return (
    <>
      <DiscoveryDelivery draft={draft} set={set} reports={reports} zone={zone} routinesChanged={routinesChanged} />
      <DiscoveryScope draft={draft} set={set} projects={projects} />
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
