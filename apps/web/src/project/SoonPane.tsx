import { EmptyState, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";

/** Honest placeholder for a screen whose API does not exist yet. Never sample data. */
export function SoonPane({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="soon">
      <EmptyState variant="dashed" size="lg" icon={icon} title={title}>
        {children}
        <span className="soon__tag">
          <Icons.Clock size={12} />
          {t("common.soon")}
        </span>
      </EmptyState>
    </div>
  );
}

/** Tasks / Resources as top-level views: page title + the placeholder. */
export function SoonScreen({ kind }: { kind: "tasks" | "resources" }) {
  const t = useT();
  const copy =
    kind === "tasks"
      ? {
          title: t("nav.tasks"),
          lead: t("tasks.lead"),
          icon: <Icons.ListChecks />,
          text: t("tasks.body"),
        }
      : {
          title: t("nav.resources"),
          lead: t("resources.lead"),
          icon: <Icons.Layers />,
          text: t("resources.body"),
        };
  return (
    <section className="page" aria-label={copy.title}>
      <header className="page__head">
        <h1 className="page__title">{copy.title}</h1>
        <p className="page__lead">{copy.lead}</p>
      </header>
      <SoonPane icon={copy.icon} title={t("common.comingSoon", { name: copy.title })}>
        {copy.text}
      </SoonPane>
    </section>
  );
}
