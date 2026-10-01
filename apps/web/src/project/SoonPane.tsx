import { EmptyState, Icons } from "@apx/ui";
import type { ReactNode } from "react";

/** Honest placeholder for a screen whose API does not exist yet. Never sample data. */
export function SoonPane({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="soon">
      <EmptyState variant="dashed" size="lg" icon={icon} title={title}>
        {children}
        <span className="soon__tag">
          <Icons.Clock size={12} />
          Pronto
        </span>
      </EmptyState>
    </div>
  );
}

/** Tareas / Recursos as top-level views: page title + the placeholder. */
export function SoonScreen({ kind }: { kind: "tasks" | "resources" }) {
  const copy =
    kind === "tasks"
      ? {
          title: "Tareas",
          lead: "De todos los proyectos. Un compromiso es una tarea con fecha que un agente prometió cumplir.",
          icon: <Icons.ListChecks />,
          text: "Acá vas a ver las tareas en curso, pendientes, en revisión y bloqueadas de cada agente.",
        }
      : {
          title: "Recursos",
          lead: "Skills, MCP, integraciones y variables que usan tus agentes, globales o por proyecto.",
          icon: <Icons.Layers />,
          text: "Vas a poder activar, asignar y revisar cada recurso sin tocar archivos.",
        };
  return (
    <section className="page" aria-label={copy.title}>
      <header className="page__head">
        <h1 className="page__title">{copy.title}</h1>
        <p className="page__lead">{copy.lead}</p>
      </header>
      <SoonPane icon={copy.icon} title={`${copy.title} llega pronto`}>
        {copy.text}
      </SoonPane>
    </section>
  );
}
