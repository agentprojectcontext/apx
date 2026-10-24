import type { ProjectKind } from "@apx/protocol";
import { Icons, type SelectOption } from "@apx/ui";
import type { T } from "../i18n/index.ts";

// A project's kind, as names, icons and picker options: apart from the settings dialog (loaded late) so the new-project
// dialog and the setup use them without it.
export const KINDS: readonly ProjectKind[] = ["personal", "app", "company", "software", "other"];
const NONE = "~none";

/** A project's kind as its name ("Company"); a kind written by hand shows as it is. */
export function kindLabel(t: T, kind: string | undefined): string {
  if (!kind) return t("project.kind.unset");
  const known = KINDS.find((k) => k === kind);
  return known ? t(`project.kind.${known}`) : kind;
}

const KIND_ICON: Record<ProjectKind, typeof Icons.Folder> = {
  personal: Icons.User,
  app: Icons.AppWindow,
  company: Icons.Building2,
  software: Icons.Code,
  other: Icons.Folder,
};

/** The icon beside a project's kind; a missing or hand-written kind gets a dashed circle. */
export function kindIcon(kind: string | undefined): typeof Icons.Folder {
  const known = KINDS.find((k) => k === kind);
  return known ? KIND_ICON[known] : Icons.CircleDashed;
}

/** The kinds a project can take, as options (with "None"), shared with the setup's project step. */
export const kindOptions = (t: T): SelectOption[] => [
  { value: NONE, label: t("project.kind.none") },
  ...KINDS.map((k) => ({ value: k, label: t(`project.kind.${k}`), description: t(`project.kind.${k}.hint`) })),
];
export const NO_KIND = NONE;
