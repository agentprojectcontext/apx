import "../styles/screens.css";
import { Dialog, Icons, NavItem, SearchField } from "@apx/ui";
import { type CSSProperties, type ReactNode, useState } from "react";
import { type MessageKey, useT } from "../i18n/index.ts";
import { LAYOUT } from "../shell/layout.ts";
import { type ConfigSection, go, useNav } from "../shell/nav.ts";
import { AdvancedSection } from "./AdvancedSection.tsx";
import { AgentsSection } from "./AgentsSection.tsx";
import { ApiTokensSection } from "./ApiTokensSection.tsx";
import { BrowserSection } from "./BrowserSection.tsx";
import { ChannelsSection } from "./ChannelsSection.tsx";
import { DesktopSection } from "./DesktopSection.tsx";
import { DevicesSection } from "./DevicesSection.tsx";
import { EnginesSection } from "./EnginesSection.tsx";
import { ExternalSection } from "./ExternalSection.tsx";
import { InterruptionsSection } from "./InterruptionsSection.tsx";
import { MemorySection } from "./MemorySection.tsx";
import { AccountSection, AppearanceSection } from "./OtherSections.tsx";
import { ProfileSection } from "./ProfileSection.tsx";
import { RouterSection } from "./RouterSection.tsx";
import { ServicesSection } from "./ServicesSection.tsx";
import { SoundsSection } from "./SoundsSection.tsx";

type NavEntry = { id: ConfigSection; label: MessageKey; icon: ReactNode; soon?: boolean };

const GROUPS: { label: MessageKey; items: NavEntry[] }[] = [
  {
    label: "config.group.general",
    items: [
      { id: "account", label: "config.account", icon: <Icons.User /> },
      { id: "appearance", label: "config.appearance", icon: <Icons.Sun /> },
      { id: "sounds", label: "config.sounds", icon: <Icons.Volume2 /> },
    ],
  },
  {
    label: "config.group.models",
    items: [
      { id: "engines", label: "config.engines", icon: <Icons.Sparkles /> },
      { id: "external", label: "config.external", icon: <Icons.Terminal /> },
      { id: "router", label: "config.router", icon: <Icons.Layers /> },
      { id: "memory", label: "config.memory", icon: <Icons.Brain /> },
      { id: "voices", label: "config.voices", icon: <Icons.Mic /> },
      { id: "images", label: "config.images", icon: <Icons.Image /> },
    ],
  },
  {
    label: "config.group.agents",
    items: [
      { id: "agents", label: "config.agents", icon: <Icons.Bot /> },
      { id: "profile", label: "config.profile", icon: <Icons.Calendar /> },
      { id: "channels", label: "config.channels", icon: <Icons.MessageCircle /> },
      { id: "interruptions", label: "config.interruptions", icon: <Icons.BellOff /> },
    ],
  },
  {
    label: "config.group.connections",
    items: [
      { id: "devices", label: "config.devices", icon: <Icons.Smartphone /> },
      { id: "api", label: "clients.title", icon: <Icons.KeyRound /> },
    ],
  },
  {
    label: "config.group.computer",
    items: [
      { id: "browser", label: "config.browser", icon: <Icons.Globe /> },
      { id: "desktop", label: "config.desktop", icon: <Icons.Monitor /> },
      { id: "advanced", label: "config.advanced", icon: <Icons.Wrench /> },
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
  const t = useT();
  const section = useNav((s) => s.config);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    label: t(g.label),
    items: g.items
      .map((i) => ({ ...i, text: t(i.label) }))
      .filter((i) => !query || `${t(g.label)} ${i.text}`.toLowerCase().includes(query)),
  })).filter((g) => g.items.length);

  return (
    <Dialog
      bare
      size="xl"
      title={t("config.title")}
      closeLabel={t("common.close")}
      open={section != null}
      onOpenChange={(o) => !o && go.config(null)}
      className="config"
      style={SIZE}
    >
      <nav className="config__nav" aria-label={t("config.sections")}>
        <SearchField
          size="sm"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        {groups.map((g) => (
          <div key={g.label} className="config__group">
            <div className="config__grouplabel">{g.label}</div>
            {g.items.map((i) => (
              <NavItem
                key={i.id}
                className="config__navitem"
                icon={i.icon}
                label={i.text}
                trailing={i.soon ? <span className="sidebar__soon">{t("common.soonLower")}</span> : undefined}
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
    case "sounds":
      return <SoundsSection />;
    case "engines":
      return <EnginesSection />;
    case "external":
      return <ExternalSection />;
    case "agents":
      return <AgentsSection />;
    case "router":
      return <RouterSection />;
    case "memory":
      return <MemorySection />;
    case "voices":
      return <ServicesSection kind="speech" />;
    case "images":
      return <ServicesSection kind="image" />;
    case "channels":
      return <ChannelsSection />;
    case "interruptions":
      return <InterruptionsSection />;
    case "profile":
      return <ProfileSection />;
    case "browser":
      return <BrowserSection />;
    case "desktop":
      return <DesktopSection />;
    case "api":
      return <ApiTokensSection />;
    case "devices":
      return <DevicesSection />;
    case "advanced":
      return <AdvancedSection />;
  }
}
