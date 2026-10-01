import { useT } from "../i18n/index.ts";
import { TasksBoard } from "./TasksBoard.tsx";

/** Tasks across every project: the office board. */
export function TasksScreen() {
  const t = useT();
  return (
    <section className="page" aria-label={t("nav.tasks")}>
      <header className="page__head">
        <h1 className="page__title">{t("nav.tasks")}</h1>
        <p className="page__lead">{t("tasks.lead")}</p>
      </header>
      <TasksBoard />
    </section>
  );
}
