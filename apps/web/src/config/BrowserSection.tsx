import { Button, Checkbox, EmptyState, Icons, SearchField, SegmentedControl } from "@apx/ui";
import { useEffect, useState } from "react";
import { cookieDomains, cookieSources, importCookies } from "../data/actions.ts";
import { SectionHead } from "./SectionHead.tsx";

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

/** Navegador: copy sessions from a local browser into APX's shared profile (runs in the desktop app). */
export function BrowserSection() {
  return (
    <>
      <SectionHead
        title="Navegador"
        lead="Copiá tus sesiones al perfil compartido del navegador de APX: si ya estás logueado en un sitio, los agentes no tienen que pedirte login."
      />
      <SessionsImport />
    </>
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
      <EmptyState variant="dashed" icon={<Icons.Globe />} title="No encontré navegadores">
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
        Elegí sólo los dominios que necesites. Chrome, Brave, Arc y Edge piden permiso del Llavero de macOS; los valores
        nunca salen de tu máquina.
      </p>{" "}
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
