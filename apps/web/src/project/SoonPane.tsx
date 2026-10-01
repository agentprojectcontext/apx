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

/** Resources as a top-level view: page title + the placeholder. */
export function SoonScreen() {
  const t = useT();
  const title = t("nav.resources");
  return (
    <section className="page" aria-label={title}>
      <header className="page__head">
        <h1 className="page__title">{title}</h1>
        <p className="page__lead">{t("resources.lead")}</p>
      </header>
      <SoonPane icon={<Icons.Layers />} title={t("common.comingSoon", { name: title })}>
        {t("resources.body")}
      </SoonPane>
    </section>
  );
}
