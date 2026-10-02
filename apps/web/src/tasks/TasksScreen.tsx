import { Button, Icons } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { TasksList } from "./TasksList.tsx";

/** Tasks across every project, in one order: what moves first, the project in its own column. */
export function TasksScreen() {
  const t = useT();
  const [creating, setCreating] = useState(false);
  return (
    <section className="page page--tasks" aria-label={t("nav.tasks")}>
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">{t("nav.tasks")}</h1>
          <p className="page__lead">{t("tasks.globalLead")}</p>
        </div>
        <Button leadingIcon={<Icons.Plus size={14} />} onClick={() => setCreating(true)}>
          {t("tasks.new")}
        </Button>
      </header>
      <TasksList creating={creating} setCreating={setCreating} />
    </section>
  );
}
