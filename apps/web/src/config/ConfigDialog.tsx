import { Button, Checkbox, Dialog, EmptyState, Icons, SearchField, SegmentedControl, Tabs } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { cookieDomains, cookieSources, importCookies, setAgentBrowserProfile } from "../data/actions.ts";
import { useData } from "../data/state.ts";

type Source = Awaited<ReturnType<typeof cookieSources>>[number];
type Domain = Awaited<ReturnType<typeof cookieDomains>>[number];

const BROWSER_NAMES: Record<string, string> = {
  zen: "Zen",
  firefox: "Firefox",
  chrome: "Chrome",
  brave: "Brave",
  arc: "Arc",
  edge: "Edge",
};

/** Config for the MVP: browser sessions and each agent's browser profile. More sections later. */
export function ConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState("browser");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Configuración"
      size="lg"
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cerrar
        </Button>
      }
    >
      <Tabs
        variant="pill"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "browser", label: "Navegador" },
          { value: "agents", label: "Agentes" },
        ]}
      />
      <div className="config__body">{tab === "browser" ? <SessionsImport /> : <AgentProfiles />}</div>
    </Dialog>
  );
}

function SessionsImport() {
  const [sources, setSources] = useState<Source[]>();
  const [source, setSource] = useState<string>();
  const [filter, setFilter] = useState("");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void cookieSources().then((s) => {
      setSources(s);
      setSource(s[0]?.id);
    });
  }, []);
  useEffect(() => {
    if (!source) return;
    const t = setTimeout(() => void cookieDomains(source, filter).then(setDomains), 200);
    return () => clearTimeout(t);
  }, [source, filter]);

  if (sources && !sources.length) {
    return (
      <EmptyState icon={<Icons.Globe />} title="No encontré navegadores">
        Abrí la app de escritorio de APX: la importación corre ahí y los valores nunca salen de tu máquina.
      </EmptyState>
    );
  }
  const toggle = (d: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(d) ? n.delete(d) : n.add(d);
      return n;
    });
  return (
    <div className="config__section">
      <p className="config__hint">
        Copiá tus sesiones al perfil compartido del navegador de APX: si ya estás logueado en un sitio, los agentes no
        tienen que pedirte login. Elegí sólo los dominios que necesites. Chrome, Brave, Arc y Edge piden permiso del
        Llavero de macOS.
      </p>
      <div className="config__row">
        <SegmentedControl
          size="sm"
          label="Navegador de origen"
          value={source}
          onValueChange={(v) => {
            setSource(v);
            setPicked(new Set());
          }}
          options={(sources ?? [])
            .slice(0, 4)
            .map((s) => ({ value: s.id, label: BROWSER_NAMES[s.browser] ?? s.browser }))}
        />
        <SearchField placeholder="Filtrar dominios" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
      </div>
      <ul className="config__list">
        {domains.slice(0, 60).map((d) => (
          <li key={d.domain}>
            <Checkbox
              checked={picked.has(d.domain)}
              onCheckedChange={() => toggle(d.domain)}
              label={d.domain}
              description={`${d.count} cookies`}
            />
          </li>
        ))}
      </ul>
      <div className="config__actions">
        <Button
          disabled={!picked.size || !source}
          loading={busy}
          onClick={async () => {
            if (!source) return;
            setBusy(true);
            await importCookies(source, [...picked]);
            setBusy(false);
            setPicked(new Set());
          }}
        >
          Importar {picked.size ? `${picked.size} dominio${picked.size > 1 ? "s" : ""}` : ""}
        </Button>
      </div>
    </div>
  );
}

function AgentProfiles() {
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      Object.values(agents)
        .filter((a) => !q || `${a.name} ${a.role}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => Number(Boolean(a.project_id)) - Number(Boolean(b.project_id)) || a.name.localeCompare(b.name))
        .slice(0, 80),
    [agents, q],
  );
  return (
    <div className="config__section">
      <p className="config__hint">
        Compartido: usa tus sesiones. Aislado: su propio perfil persistente. Incógnito: arranca vacío cada vez.
      </p>
      <SearchField placeholder="Buscar agente" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      <ul className="config__list">
        {list.map((a) => (
          <li key={a.id} className="config__agent">
            <span className="config__agentname">
              <b>{a.name}</b>
              <span>{a.project_id ? (projects.find((p) => p.id === a.project_id)?.name ?? "") : "global"}</span>
            </span>
            <SegmentedControl
              size="sm"
              label={`Perfil de ${a.name}`}
              value={a.browser_profile}
              onValueChange={(v) => void setAgentBrowserProfile(a.id, v as "shared" | "isolated" | "incognito")}
              options={[
                { value: "shared", label: "Compartido" },
                { value: "isolated", label: "Aislado" },
                { value: "incognito", label: "Incógnito" },
              ]}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
