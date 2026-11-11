import "../../styles/panel-parts.css";
import { SegmentedControl } from "@apx/ui";
import { useState } from "react";
import type { ProjectEntry } from "../../data/identity.ts";
import { useT } from "../../i18n/index.ts";
import { FilesPane, NoFolder } from "./FilesPane.tsx";
import { GitPane } from "./GitPane.tsx";

type Scope = "folder" | "git";

/**
 * A project's directory: its folder (the base project's is APX's work folder, where its chats work) and, for a
 * project with a folder of its own, its Git changes and history.
 */
export function ProjectFiles({ project }: { project: ProjectEntry }) {
  const t = useT();
  const [scope, setScope] = useState<Scope>("folder");
  return (
    <div className="chatfiles">
      {/* The base project's folder is APX's own, never a repository: it has only the folder, so no switch. */}
      {project.path && (
        <div className="chatfiles__bar chatfiles__bar--project">
          <SegmentedControl
            size="sm"
            label={t("files.scope")}
            value={scope}
            onValueChange={(v) => setScope(v as Scope)}
            options={[
              { value: "folder", label: t("files.scope.folder") },
              { value: "git", label: t("files.scope.git") },
            ]}
          />
        </div>
      )}
      {scope === "git" && project.path ? (
        <GitPane key={project.id} projectId={project.id} />
      ) : project.isDefault ? (
        <FilesPane key="base" where={{ base: true }} label={t("files.workFolder")} />
      ) : project.path ? (
        <FilesPane key={project.id} where={{ project: project.id }} root={project.path} />
      ) : (
        <NoFolder />
      )}
    </div>
  );
}
