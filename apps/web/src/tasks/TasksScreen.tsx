import "../styles/screens.css";
import { useState } from "react";
import { SectionPage } from "../common/SectionPage.tsx";
import { useT } from "../i18n/index.ts";
import { GroupsHelp, TasksList } from "./TasksList.tsx";

/** Tasks across every project, in one order: what moves first, the project in its own column. */
export function TasksScreen() {
  const t = useT();
  const [creating, setCreating] = useState(false);
  return (
    <SectionPage
      className="page--tasks"
      bodyClassName="page"
      label={t("nav.tasks")}
      title={t("nav.tasks")}
      titleExtra={<GroupsHelp />}
      lead={t("tasks.globalLead")}
      action={{ label: t("tasks.new"), hint: t("section.tasks.newHint"), onClick: () => setCreating(true) }}
    >
      <TasksList creating={creating} setCreating={setCreating} />
    </SectionPage>
  );
}
