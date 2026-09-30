import { ApxProvider, Badge, Composer, NavItem, SectionLabel, SystemNote } from "@apx/ui";
import { useHealth } from "./useHealth.ts";

// F0 shell: sidebar + thread. The real screens come from the Claude Design handoff (plan §11).
export function App() {
  const { health, error } = useHealth();
  return (
    <ApxProvider look="minimal" mode="light" fill>
      <div className="shell">
        <aside className="shell__sidebar">
          <div className="shell__brand">APX</div>
          <NavItem label="Home" active />
          <NavItem label="Inbox" />
          <NavItem label="En curso" />
          <SectionLabel>Proyectos</SectionLabel>
        </aside>
        <main className="shell__main">
          <header className="shell__header">
            <span>Home</span>
            {health ? (
              <Badge tone="brand">core {health.code_sha}</Badge>
            ) : (
              <Badge tone="danger">{error ? "core offline" : "…"}</Badge>
            )}
          </header>
          <section className="shell__thread">
            <SystemNote>APX v2 · F0. El chat llega en F2; el navegador embebido en F1.</SystemNote>
          </section>
          <footer className="shell__composer">
            <Composer placeholder="Escribile a tu secretario…" />
          </footer>
        </main>
      </div>
    </ApxProvider>
  );
}
