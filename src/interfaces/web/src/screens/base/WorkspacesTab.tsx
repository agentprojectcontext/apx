import { useNavigate } from "react-router-dom";
import { FolderKanban, Plus } from "lucide-react";
import { Section } from "../../components/Section";
import { Badge, Button, Empty, Loading } from "../../components/ui";
import { projectKindLabel } from "../../components/layout/ProjectSidebar";
import { useProjects } from "../../hooks/useProjects";

export function WorkspacesTab() {
  const navigate = useNavigate();
  const { projects, isLoading } = useProjects();

  return (
    <Section
      title="Workspaces"
      description="Todos los proyectos registrados en APX."
      action={
        <Button size="sm" variant="primary" onClick={() => navigate("/p/0/workspaces?action=add-project")}>
          <Plus size={14} /> Nuevo proyecto
        </Button>
      }
    >
      {isLoading && <Loading />}
      {!isLoading && projects.length === 0 && <Empty>Sin proyectos. Agregá uno con el botón de arriba.</Empty>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => {
          const isBase = String(p.id) === "0";
          const label = isBase ? "Base" : (p.name || p.path.split("/").pop() || String(p.id));
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/p/${p.id}`)}
              className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-muted-fg/50"
            >
              <div className="flex items-center gap-2">
                <FolderKanban className="size-4 text-muted-fg" />
                <span className="truncate text-sm font-semibold">{label}</span>
                <Badge tone={isBase ? "success" : "info"}>{isBase ? "Base" : projectKindLabel(p.kind)}</Badge>
              </div>
              <p className="truncate font-mono text-[10px] text-muted-fg">{p.path}</p>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
