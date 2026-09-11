import { Folder } from "lucide-react";
import { cn } from "../../lib/cn";
import { OptionFilter } from "./OptionFilter";
import { isDefaultProject, projectLabel, type ProjectOption } from "../../lib/provenance";
import { t } from "../../i18n";

/**
 * Which projects' conversations this device wants to see.
 *
 * The same control as the channel filter beside it, asking the other half of
 * the question: the channel says where a conversation HAPPENED, this says where
 * it COMES FROM. The inbox is one flat list across every project at once, so
 * without this there is no way to read just one project's day.
 *
 * The default workspace is an option like any other here — you may well want to
 * see only the super-agent's own conversations — even though it is the one
 * project that never wears a badge on a row (see `ProjectTag`).
 */
export function ProjectFilter({
  projects,
  enabled,
  onToggle,
  onSetAll,
  testIdPrefix,
}: {
  projects: ProjectOption[];
  enabled: (id: string) => boolean;
  onToggle: (id: string) => void;
  onSetAll?: (on: boolean) => void;
  testIdPrefix: string;
}) {
  return (
    <OptionFilter
      label={t("provenance.filter")}
      options={projects.map((p) => ({ value: p.id, label: p.label, count: p.count }))}
      enabled={enabled}
      onToggle={onToggle}
      onSetAll={onSetAll}
      testIdPrefix={testIdPrefix}
    />
  );
}

/**
 * WHERE an agent comes from, as a tag on the row and in the thread header.
 *
 * Its own badge, next to but never inside the channel's: they are two facts
 * about the same conversation and either one alone leaves a reader guessing.
 * "Zoya · Web" does not say whose Zoya; "Zoya · Appsi" does not say where she
 * said it.
 *
 * Nothing is drawn for the default workspace. That is where the super-agent
 * lives and where everything without a project of its own lands, so a badge
 * there would sit on most of the list saying "the usual place" — and a badge
 * that is always on stops being read at all. It marks the exceptions.
 */
export function ProjectTag({
  projectId,
  name,
  className,
}: {
  projectId: number | string | null | undefined;
  name?: string | null;
  className?: string;
}) {
  if (isDefaultProject(projectId)) return null;
  const label = projectLabel(projectId, name);
  if (!label) return null;
  return (
    <span
      data-testid={`project-tag-${projectId}`}
      /* The visible text is a bare name in a line of other bare names. Said
         out loud it needs the preposition to mean anything, and a native
         `title` is not a tooltip this panel is allowed to use (rule: <Tip>). */
      aria-label={t("provenance.from", { project: label })}
      className={cn(
        // Outlined where the channel tag is filled: at 10px the two have to be
        // told apart at a glance, and a second grey block beside the first
        // reads as one tag that wrapped.
        "inline-flex min-w-0 shrink items-center gap-1 rounded border border-border px-1.5 py-px text-[10px] font-medium text-muted-fg",
        className,
      )}
    >
      <Folder className="size-2.5 shrink-0 opacity-70" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
