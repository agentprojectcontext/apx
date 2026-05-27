import useSWR from "swr";
import { Section, StatusDot } from "../components/Section";
import { Admin, Engines, Health, Projects, Telegram } from "../lib/api";

/**
 * Default APX view: the system-wide config + status. Reads everything from
 * the daemon endpoints we already have; no new server-side surface required.
 * Edits roundtrip through PATCH and call /admin/reload.
 */
export function ApxAdminScreen() {
  const health    = useSWR("/health",            () => Health.get(),       { refreshInterval: 5_000 });
  const projects  = useSWR("/projects",          () => Projects.list(),    { refreshInterval: 15_000 });
  const engines   = useSWR("/engines",           () => Engines.list());
  const telegram  = useSWR("/telegram/status",   () => Telegram.status());
  const channels  = useSWR("/telegram/channels", () => Telegram.channels.list());

  const onReload = async () => {
    try {
      await Admin.reload();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">APX</h1>
          <p className="text-sm text-muted-fg">
            Panel general. Aquí vive la configuración global y la del proyecto por defecto.
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm hover:bg-accent"
          title="POST /admin/reload — relee ~/.apx/config.json sin reiniciar el daemon"
        >
          ↻ reload config
        </button>
      </header>

      <Section title="Daemon">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <Stat label="Versión" value={health.data?.version || "—"} />
          <Stat label="Uptime"  value={health.data ? `${health.data.uptime_s}s` : "—"} />
          <Stat label="Status"  value={health.error ? "down" : "running"} ok={!health.error} />
        </div>
      </Section>

      <Section
        title="Engines"
        description="Adaptadores LLM disponibles. La configuración de api_key vive en ~/.apx/config.json."
      >
        <ul className="space-y-2 text-sm">
          {(engines.data?.engines || []).map((id) => (
            <li key={id} className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
              <span className="font-mono">{id}</span>
              <span className="text-xs text-muted-fg">core/engines/{id}.js</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Telegram"
        description="Canales configurados. Cada uno puede estar pineado a un proyecto y opcionalmente atendido por un agente master."
      >
        <div className="mb-3 flex items-center gap-3 text-sm">
          <StatusDot ok={Boolean(telegram.data?.enabled)} />
          <span>{telegram.data?.enabled ? "polling activo" : "deshabilitado"}</span>
        </div>
        <ul className="space-y-2 text-sm">
          {(channels.data?.channels || []).map((c) => (
            <li key={c.name} className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                {c.project && (
                  <span className="rounded-md bg-accent px-2 py-0.5 text-xs">
                    project = {c.project}
                  </span>
                )}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted-fg">
                <span>chat_id: {c.chat_id || "—"}</span>
                <span>route_to_agent: {c.route_to_agent || "default APX"}</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Proyectos registrados"
        description="Click sobre uno (en la barra izquierda) para abrir su panel."
      >
        <ul className="space-y-1 text-sm">
          {(projects.data || []).map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md px-3 py-1.5 hover:bg-muted/40">
              <span className="font-mono text-xs text-muted-fg">#{p.id}</span>
              <span className="flex-1 px-3">{p.name || p.path.split("/").pop()}</span>
              <span className="text-xs text-muted-fg">{p.path}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-fg">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-base font-medium">
        {ok !== undefined && <StatusDot ok={ok} />}
        <span>{value}</span>
      </div>
    </div>
  );
}
