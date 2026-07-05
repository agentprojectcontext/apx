import { useState } from "react";
import useSWR from "swr";
import {
  AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Eye, EyeOff, Loader2, WifiOff, X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Integrations, type IntegrationScope, type IntegrationStatus } from "../../lib/api";
import { PluginCard } from "./PluginCard";
import { PluginToolsSection, type PluginTool } from "./PluginToolsSection";

function AsanaLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.833 9.637a4.167 4.167 0 1 1 0 8.333 4.167 4.167 0 0 1 0-8.333zm-13.666 0a4.167 4.167 0 1 1 0 8.333 4.167 4.167 0 0 1 0-8.333zM12 2a4.167 4.167 0 1 1 0 8.333A4.167 4.167 0 0 1 12 2z" />
    </svg>
  );
}

const ASANA_TOOLS: PluginTool[] = [
  { slug: "asana_list_projects", desc: "Listar proyectos del workspace" },
  { slug: "asana_list_tasks", desc: "Listar tareas de un proyecto" },
  { slug: "asana_create_task", desc: "Crear una tarea" },
  { slug: "asana_update_task", desc: "Actualizar estado o campos de una tarea" },
];

const HELP_STEPS = [
  "Abrí app.asana.com/0/my-apps en el navegador.",
  'Bajá hasta la sección "Personal access tokens" (no tus apps OAuth).',
  'Hacé clic en "+ New access token".',
  "Dale un nombre y confirmá.",
  'Copiá el token completo — empieza con "1/..." y tiene un ":" en el medio.',
  "Pegalo en el campo de abajo.",
];

type Step = "idle" | "saving" | "validating" | "done";

export function AsanaPlugin({ pid, scope }: { pid: string; scope: IntegrationScope }) {
  const [expanded, setExpanded] = useState(false);
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<{ gid: string; name: string }[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState("");

  const key = `asana-status-${pid}-${scope}`;
  const { data: status, mutate, isLoading } = useSWR<IntegrationStatus>(
    key,
    () => Integrations.status(pid, "asana", scope),
    { shouldRetryOnError: false },
  );

  const isActive = status?.status === "active" && status.is_enabled;
  const busy = step === "saving" || step === "validating";

  async function handleConnect() {
    if (!pat.trim()) return;
    setStep("saving");
    setError(null);
    try {
      await Integrations.asanaConfigure(pid, scope, { personalAccessToken: pat.trim() });
      setStep("validating");
      const result = await Integrations.asanaValidate(pid, scope);
      await mutate();
      if (!result.workspace_gid) {
        const ws = await Integrations.asanaWorkspaces(pid, scope);
        if (ws.workspaces.length > 1) setWorkspaces(ws.workspaces);
      }
      setStep("done");
      setPat("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al conectar con Asana");
      setStep("idle");
    }
  }

  async function handleSelectWorkspace() {
    if (!selectedWorkspace) return;
    setStep("saving");
    setError(null);
    try {
      await Integrations.asanaConfigure(pid, scope, { workspaceGid: selectedWorkspace });
      await Integrations.asanaValidate(pid, scope);
      await mutate();
      setWorkspaces([]);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al seleccionar workspace");
      setStep("idle");
    }
  }

  async function handleDeactivate() {
    setError(null);
    try {
      await Integrations.deactivate(pid, "asana", scope);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al desactivar");
    }
  }

  return (
    <PluginCard
      icon={
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-500/20 to-pink-500/20">
          <AsanaLogo className="h-6 w-6 text-rose-400" />
        </div>
      }
      title="Asana"
      description="Conectá tu workspace de Asana para que los agentes creen, actualicen y consulten tareas"
      hasTools
      badges={
        <span
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
            isActive
              ? "border-emerald-700 bg-emerald-900/20 text-emerald-400"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-400" : "bg-muted-foreground")} />
          {isLoading ? "..." : isActive ? "Activo" : status?.status === "error" ? "Error" : "No configurado"}
        </span>
      }
      rightContent={
        isActive && status?.workspace_name ? (
          <span className="max-w-[120px] truncate font-mono text-[10px] text-muted-foreground">
            {status.workspace_name}
          </span>
        ) : null
      }
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="space-y-4 p-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-700/30 bg-red-900/20 px-3 py-2.5 text-xs text-red-300">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {isActive && (
          <div className="space-y-1 rounded-xl border border-emerald-700/30 bg-emerald-900/10 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">Conectado como {status?.user_name}</span>
            </div>
            {status?.user_email && <p className="pl-5 text-[10px] text-muted-foreground">{status.user_email}</p>}
            {status?.workspace_name && (
              <p className="pl-5 text-[10px] text-muted-foreground">Workspace: {status.workspace_name}</p>
            )}
          </div>
        )}

        {workspaces.length > 1 && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">Seleccioná el workspace a usar:</p>
            <div className="flex gap-2">
              <select
                value={selectedWorkspace}
                onChange={(e) => setSelectedWorkspace(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-rose-500/50"
              >
                <option value="">Seleccionar workspace...</option>
                {workspaces.map((ws) => (
                  <option key={ws.gid} value={ws.gid}>{ws.name}</option>
                ))}
              </select>
              <button
                onClick={handleSelectWorkspace}
                disabled={!selectedWorkspace || busy}
                className="rounded-lg border border-rose-700/50 px-3 py-1.5 text-xs text-rose-400 transition-all hover:bg-rose-900/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirmar"}
              </button>
            </div>
          </div>
        )}

        {(!isActive || step === "idle") && workspaces.length === 0 && (
          <div className="space-y-3">
            <p className="mb-1 text-xs font-semibold text-foreground">Credenciales Asana</p>

            <div className="overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-muted/40"
              >
                <span className="text-[11px] text-muted-foreground">
                  ¿Cómo obtener el token? ·{" "}
                  <a
                    href="https://app.asana.com/0/my-apps"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 text-rose-400 hover:underline"
                  >
                    app.asana.com/0/my-apps <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </span>
                <ChevronDown className={cn("h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform", showHelp && "rotate-180")} />
              </button>
              {showHelp && (
                <div className="space-y-1.5 border-t border-border px-3 pb-3 pt-2.5">
                  {HELP_STEPS.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 flex-shrink-0 font-mono text-[10px] text-rose-400/70">{i + 1}.</span>
                      <p className="text-[11px] text-muted-foreground">{s}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">Personal Access Token</label>
              <div className="relative">
                <input
                  type={showPat ? "text" : "password"}
                  placeholder="1/1234567890abcdef:..."
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-14 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-rose-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPat((v) => !v)}
                  className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPat ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showPat ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            {step === "validating" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando token con Asana...
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={!pat.trim() || busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-700/50 px-3 py-2 text-xs text-rose-400 transition-all hover:bg-rose-900/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />{step === "saving" ? "Guardando..." : "Validando..."}</>
              ) : isActive ? "Reconectar" : "Conectar"}
            </button>
          </div>
        )}

        <PluginToolsSection pid={pid} tools={ASANA_TOOLS} isActive={!!isActive} />

        {isActive && (
          <div className="flex justify-end border-t border-border pt-2">
            <button
              onClick={handleDeactivate}
              className="flex items-center gap-1.5 rounded-lg border border-red-700/50 px-3 py-1.5 text-xs text-red-400 transition-all hover:bg-red-900/20"
            >
              <WifiOff className="h-3.5 w-3.5" /> Desactivar
            </button>
          </div>
        )}
      </div>
    </PluginCard>
  );
}
