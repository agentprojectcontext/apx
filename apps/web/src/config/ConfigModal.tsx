import { Dialog, Icons, NavItem, SearchField } from "@apx/ui";
import { type CSSProperties, type ReactNode, useState } from "react";
import { LAYOUT } from "../shell/layout.ts";
import { type ConfigSection, go, useNav } from "../shell/nav.ts";
import { AgentsSection } from "./AgentsSection.tsx";
import { BrowserSection } from "./BrowserSection.tsx";
import { EnginesSection } from "./EnginesSection.tsx";
import { AccountSection, AdvancedSection, AppearanceSection, ChannelSection } from "./OtherSections.tsx";

type NavEntry = { id: ConfigSection; label: string; icon: ReactNode; soon?: boolean };

const GROUPS: { label: string; items: NavEntry[] }[] = [
  {
    label: "Configuración",
    items: [
      { id: "account", label: "Cuenta", icon: <Icons.User /> },
      { id: "appearance", label: "Apariencia", icon: <Icons.Sun /> },
    ],
  },
  {
    label: "Agentes",
    items: [
      { id: "engines", label: "Motores y modelos", icon: <Icons.Sparkles /> },
      { id: "agents", label: "Agentes", icon: <Icons.Bot /> },
    ],
  },
  {
    label: "Canales",
    items: [
      { id: "whatsapp", label: "WhatsApp", icon: <Icons.MessageCircle />, soon: true },
      { id: "telegram", label: "Telegram", icon: <Icons.Send />, soon: true },
      { id: "discord", label: "Discord", icon: <Icons.Users />, soon: true },
    ],
  },
  {
    label: "Esta computadora",
    items: [
      { id: "browser", label: "Navegador", icon: <Icons.Globe /> },
      { id: "advanced", label: "Daemon y avanzado", icon: <Icons.Wrench /> },
    ],
  },
];

// The dialog portals outside .shell, so it gets its sizes here instead of the --shell-* variables.
const SIZE = {
  width: `min(${LAYOUT.configW}px, calc(100vw - 64px))`,
  height: `min(${LAYOUT.configH}px, calc(100vh - 64px))`,
  "--config-nav-w": `${LAYOUT.configNavW}px`,
} as CSSProperties;

/** Config: a large modal with a grouped left nav (SPEC §2.12 Config). Open with go.config(section). */
export function ConfigModal() {
  const section = useNav((s) => s.config);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !query || `${g.label} ${i.label}`.toLowerCase().includes(query)),
  })).filter((g) => g.items.length);

  return (
    <Dialog
      bare
      size="xl"
      title="Configuración"
      open={section != null}
      onOpenChange={(o) => !o && go.config(null)}
      className="config"
      style={SIZE}
    >
      <nav className="config__nav" aria-label="Secciones de configuración">
        <SearchField size="sm" placeholder="Buscar" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        {groups.map((g) => (
          <div key={g.label} className="config__group">
            <div className="config__grouplabel">{g.label}</div>
            {g.items.map((i) => (
              <NavItem
                key={i.id}
                className="config__navitem"
                icon={i.icon}
                label={i.label}
                trailing={i.soon ? <span className="sidebar__soon">pronto</span> : undefined}
                active={section === i.id}
                onClick={() => go.config(i.id)}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className="config__content">
        <div className="config__inner">{section && <Body section={section} />}</div>
      </div>
    </Dialog>
  );
}

function Body({ section }: { section: ConfigSection }) {
  switch (section) {
    case "account":
      return <AccountSection />;
    case "appearance":
      return <AppearanceSection />;
    case "engines":
      return <EnginesSection />;
    case "agents":
      return <AgentsSection />;
    case "whatsapp":
    case "telegram":
    case "discord":
      return <ChannelSection channel={section} />;
    case "browser":
      return <BrowserSection />;
    case "advanced":
      return <AdvancedSection />;
  }
}
