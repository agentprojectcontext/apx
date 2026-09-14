import { useState } from "react";
import useSWR from "swr";
import { Link } from "react-router-dom";
import { AlertTriangle, Briefcase, Check, Heart, Power } from "lucide-react";
import { Agents } from "../../lib/api";
import { ProjectProfiles, type ProjectProfileOption } from "../../lib/api/profiles";
import { Badge, Button, Loading } from "../ui";
import { useToast } from "../Toast";
import { cn } from "../../lib/cn";
import { toneText } from "../../lib/tone";
import { t } from "../../i18n";
import { projectKindOptions } from "./projectKinds";

// A project's PROFILE — the half of "what kind of project is this" that the
// panel could not reach.
//
// `kind: company` only ever added Estructura to the rail and offered the
// executive team in Agents → Import. What makes a project OPERATE like a
// company is a separate switch: a project-scoped profile package, whose
// routines are the rituals (daily pulse, weekly review, decision brief,
// scorecard) and the council's own runs. Until these components existed that
// switch was `apx profile use company --project <name>` and nothing in the web
// said so, which is how a project could sit marked Empresa with not one ritual
// running and no way to tell from the screen.

export function useProjectProfile(pid: string) {
  return useSWR(`/api/projects/${pid}/profile`, () => ProjectProfiles.get(pid));
}

function kindLabel(kind?: string | null) {
  return projectKindOptions().find((k) => k.value === kind)?.label || kind || "";
}

/**
 * The package a project of this kind is missing.
 *
 * Matched by id against the project's own kind rather than "the only one
 * installed": a suggestion that fires on every project is one nobody reads, and
 * the honest claim here is narrow — this project says it is a company and is
 * not running the company package.
 */
function candidateFor(options: ProjectProfileOption[] | undefined, kind?: string | null) {
  if (!options?.length || !kind) return null;
  return options.find((o) => o.id === kind) || null;
}

/** Slugs the profile addresses that this project has no agent for. */
function useMissingAgents(pid: string, option: ProjectProfileOption | null) {
  const roster = useSWR(option?.agents.length ? `/api/projects/${pid}/agents` : null, () => Agents.list(pid));
  if (!option?.agents.length || !roster.data) return [];
  const have = new Set(roster.data.map((a) => a.slug));
  return option.agents.filter((slug) => !have.has(slug));
}

/**
 * Overview's banner: one line saying the project is not what it says it is, and
 * the button that fixes it. Silent in every other case — a project running its
 * profile, or one whose kind has no package, gets nothing.
 */
export function ProjectProfileNotice({ pid, kind }: { pid: string; kind?: string | null }) {
  const { data, mutate } = useProjectProfile(pid);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const candidate = candidateFor(data?.available, kind);
  const missing = useMissingAgents(pid, candidate);

  if (!data || data.active || !candidate) return null;

  const activate = async () => {
    setBusy(true);
    try {
      const out = await ProjectProfiles.activate(pid, candidate.id);
      toast.success(t("project.profile.activated", { id: candidate.name, count: out.routines?.installed?.length ?? 0 }));
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="project-profile-notice"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
    >
      <AlertTriangle size={16} className={cn("mt-0.5 shrink-0", toneText.amber)} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn("text-sm font-medium", toneText.amber)}>
          {t("project.profile.notice_title", { kind: kindLabel(kind) })}
        </p>
        <p className="text-xs leading-snug text-muted-fg">
          {t("project.profile.notice_body", { name: candidate.name, count: candidate.provides?.routines?.length ?? 0 })}
        </p>
        {!!missing.length && (
          <p className={cn("text-xs leading-snug", toneText.amber)}>
            {t("project.profile.missing_agents", { slugs: missing.join(", ") })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link to={`/p/${pid}/config`} className="text-xs text-muted-fg underline-offset-2 hover:underline">
          {t("project.profile.notice_config")}
        </Link>
        <Button size="sm" variant="primary" loading={busy} onClick={activate}>
          <Briefcase size={13} /> {t("project.profile.activate")}
        </Button>
      </div>
    </div>
  );
}

/** Config's section: every package this project could run, and the switch. */
export function ProjectProfileSection({ pid, kind }: { pid: string; kind?: string | null }) {
  const { data, isLoading, mutate } = useProjectProfile(pid);
  const toast = useToast();
  const [busy, setBusy] = useState("");

  if (isLoading) return <Loading />;
  if (!data?.available.length) return null;

  const activate = async (option: ProjectProfileOption) => {
    // Replacing is a real loss — the outgoing package's routines are stood down
    // — so it is asked about, once, instead of being a `force` the caller sets
    // by habit.
    if (data.active && data.active !== option.id) {
      const active = data.available.find((o) => o.id === data.active)?.name || data.active;
      if (!window.confirm(t("project.profile.replace_confirm", { active, next: option.name }))) return;
    }
    setBusy(option.id);
    try {
      const out = await ProjectProfiles.activate(pid, option.id, true);
      toast.success(t("project.profile.activated", { id: option.name, count: out.routines?.installed?.length ?? 0 }));
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const deactivate = async (option: ProjectProfileOption) => {
    setBusy(option.id);
    try {
      const out = await ProjectProfiles.deactivate(pid);
      toast.success(t("project.profile.deactivated", { id: option.name, count: out.disabled?.length ?? 0 }));
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3" data-testid="project-profile-section">
      <div>
        <h3 className="text-sm font-medium">{t("project.profile.title")}</h3>
        <p className="text-xs text-muted-fg">{t("project.profile.desc")}</p>
      </div>
      <div className="space-y-2">
        {data.available.map((option) => (
          <ProfileRow
            key={option.id}
            pid={pid}
            option={option}
            suggested={option.id === kind && !data.active}
            busy={busy === option.id}
            onActivate={() => activate(option)}
            onDeactivate={() => deactivate(option)}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileRow({
  pid, option, suggested, busy, onActivate, onDeactivate,
}: {
  pid: string;
  option: ProjectProfileOption;
  suggested: boolean;
  busy: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const missing = useMissingAgents(pid, option);
  const routines = option.provides?.routines || [];

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        option.active ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-muted/30",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <Briefcase size={15} className="mt-0.5 shrink-0 text-muted-fg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{option.name}</span>
            {option.active && <Badge tone="success"><Check size={9} /> {t("project.profile.active")}</Badge>}
            {suggested && <Badge tone="warning"><AlertTriangle size={9} /> {t("project.profile.suggested")}</Badge>}
            {!!routines.length && (
              <Badge tone="muted"><Heart size={9} /> {t("project.profile.routines_count", { count: routines.length })}</Badge>
            )}
          </div>
          {option.description && <p className="mt-0.5 text-xs leading-snug text-muted-fg">{option.description}</p>}
          {!!option.agents.length && (
            <p className="mt-1 text-[11px] text-muted-fg">
              {t("project.profile.agents_needed", { slugs: option.agents.join(", ") })}
            </p>
          )}
          {!!missing.length && (
            <p className={cn("mt-1 text-[11px] leading-snug", toneText.amber)}>
              <AlertTriangle size={10} className="mr-1 inline align-[-1px]" />
              {t("project.profile.missing_agents", { slugs: missing.join(", ") })}
            </p>
          )}
        </div>
        <div className="shrink-0">
          {option.active ? (
            <Button size="sm" variant="ghost" loading={busy} onClick={onDeactivate}>
              <Power size={13} /> {t("project.profile.deactivate")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" loading={busy} onClick={onActivate}>
              {t("project.profile.activate")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
