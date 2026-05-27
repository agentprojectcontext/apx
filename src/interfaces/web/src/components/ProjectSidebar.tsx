import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import useSWR from "swr";
import {
  Building2,
  AppWindow,
  Box,
  User,
  Settings,
  Plus,
  CircleDot,
} from "lucide-react";
import { Projects, type ProjectEntry, type ProjectKind } from "../lib/api";
import { cn } from "../lib/cn";

interface Props {
  onSelect: (href: string) => void;
}

/**
 * Vertical rail of project avatars, Discord/Slack-style. First item is always
 * "APX" (general admin / default project). Then registered projects in the
 * order the daemon returns. Bottom: settings + add-project quick action.
 */
export function ProjectSidebar({ onSelect }: Props) {
  const { data, isLoading } = useSWR<ProjectEntry[]>(
    "/projects",
    () => Projects.list(),
    { refreshInterval: 15_000 }
  );
  const projects = (data || []).filter((p) => Number(p.id) !== 0);
  const location = useLocation();

  return (
    <aside className="flex h-full w-16 flex-col items-center gap-2 border-r border-border bg-card py-3">
      <Avatar
        title="APX"
        kind="default"
        active={location.pathname === "/"}
        onClick={() => onSelect("/")}
      />
      <div className="my-1 h-px w-8 bg-border" />
      {isLoading && <div className="size-10 rounded-xl bg-muted animate-pulse" />}
      {projects.map((p) => (
        <Avatar
          key={p.id}
          title={p.name || String(p.id)}
          path={p.path}
          kind={(p.kind as ProjectKind) || "other"}
          active={location.pathname.startsWith(`/p/${p.id}`)}
          onClick={() => onSelect(`/p/${p.id}`)}
        />
      ))}
      <div className="flex-1" />
      <Avatar
        title="Agregar proyecto"
        icon={<Plus size={20} />}
        kind="add"
        onClick={() => onSelect("/?action=add-project")}
      />
      <Avatar
        title="Settings"
        icon={<Settings size={18} />}
        kind="settings"
        active={location.pathname === "/settings"}
        onClick={() => onSelect("/settings")}
      />
    </aside>
  );
}

interface AvatarProps {
  title: string;
  path?: string;
  kind?: ProjectKind | "default" | "settings" | "add";
  icon?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

function Avatar({ title, path, kind = "other", icon, active, onClick }: AvatarProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      className="group relative"
      aria-label={title}
    >
      <span
        className={cn(
          "absolute -left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full transition-all",
          active ? "bg-foreground" : "bg-transparent group-hover:bg-muted-fg"
        )}
      />
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-xl transition-all",
          active
            ? "bg-accent text-accent-fg"
            : "bg-muted text-muted-fg hover:bg-accent hover:text-accent-fg",
          kind === "add" && "border border-dashed border-muted-fg/40 bg-transparent"
        )}
      >
        {icon ?? <KindIcon kind={kind} title={title} />}
      </span>
      {showTip && (
        <span className="pointer-events-none absolute left-12 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md">
          <span className="block text-foreground">{title}</span>
          {path && <span className="block text-muted-fg">{path}</span>}
        </span>
      )}
    </button>
  );
}

function KindIcon({ kind, title }: { kind: string; title: string }) {
  if (kind === "default") return <span className="text-base font-bold">A</span>;
  if (kind === "settings") return <Settings size={18} />;
  if (kind === "add") return <Plus size={18} />;
  if (kind === "company") return <Building2 size={18} />;
  if (kind === "app") return <AppWindow size={18} />;
  if (kind === "software") return <Box size={18} />;
  if (kind === "personal") return <User size={18} />;
  // Fallback: first letter of project name.
  const letter = title.trim().charAt(0).toUpperCase() || <CircleDot size={16} />;
  return <span className="text-sm font-semibold">{letter}</span>;
}

/** Helper for header / breadcrumb display. */
export function projectKindLabel(kind?: string): string {
  switch (kind) {
    case "personal": return "Personal";
    case "company": return "Empresa";
    case "app": return "App";
    case "software": return "Software";
    case "other": return "Otro";
    default: return "Proyecto";
  }
}

// Quiet unused import warnings in TSX if useEffect lands unused in a refactor.
void useEffect;
