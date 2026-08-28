import { FolderGit2, Layers } from "lucide-react";
import { UiSelect } from "../UiSelect";
import { t } from "../../i18n";
import type { ProjectEntry } from "../../types/daemon";

/** The "no project chosen" value — every project's sessions. */
export const ALL_PROJECTS = "";

interface Props {
  projects: ProjectEntry[];
  value: string;
  onChange: (pid: string) => void;
  disabled?: boolean;
  /**
   * Add the "All projects" entry. On by default: this control FILTERS the
   * session list, and the unfiltered list is what it opens on. Pass false where
   * the control has to name one project — creating a session, which has to land
   * somewhere.
   */
  allowAll?: boolean;
}

// Project picker for the Code module.
//
// This is a FILTER over the session list, not the module's mode. A code session
// belongs to the project whose cwd it was started from, so a panel that only
// ever showed one project's sessions hid every session started anywhere else —
// with no hint that there were any. Default to all; narrow on purpose.
//
// We label projects by name (falling back to the basename of their path) so the
// dropdown is human-readable.
export function CodeProjectPicker({ projects, value, onChange, disabled, allowAll = true }: Props) {
  const options = projects.map((p) => {
    const base = p.path?.split("/").filter(Boolean).pop() || t("modules_ui.code_project_fallback", { id: p.id });
    return {
      value: String(p.id),
      label: p.name || base,
      icon: FolderGit2,
      description: p.path,
    };
  });

  if (allowAll) {
    options.unshift({
      value: ALL_PROJECTS,
      label: t("code_module.all_projects"),
      icon: Layers,
      description: t("code_module.all_projects_desc"),
    });
  }

  return (
    <div className="w-full" data-testid="code-project-select">
      <UiSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={t("modules_ui.code_pick_project_ph")}
        disabled={disabled}
        showIcon
      />
    </div>
  );
}
