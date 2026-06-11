import { FolderGit2 } from "lucide-react";
import { UiSelect } from "../UiSelect";
import type { ProjectEntry } from "../../types/daemon";

interface Props {
  projects: ProjectEntry[];
  value: string;
  onChange: (pid: string) => void;
  disabled?: boolean;
}

// Project picker for the Code module. The selected project scopes the
// assistant's working context (it rides the project-scoped super-agent
// stream), mirroring how the `apx code` CLI resolves a project id before the
// REPL starts. We label projects by name (falling back to the basename of
// their path) so the dropdown is human-readable.
export function CodeProjectPicker({ projects, value, onChange, disabled }: Props) {
  const options = projects.map((p) => {
    const base = p.path?.split("/").filter(Boolean).pop() || `proyecto ${p.id}`;
    return {
      value: String(p.id),
      label: p.name || base,
      icon: FolderGit2,
      description: p.path,
    };
  });

  return (
    <div className="w-full" data-testid="code-project-select">
      <UiSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder="Elegí un proyecto…"
        disabled={disabled}
      />
    </div>
  );
}
