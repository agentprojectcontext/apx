import { type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bot, Cpu, KeyRound, MessageCircle, Palette, ScrollText, Send, Smartphone, User,
} from "lucide-react";
import { TabNav, NavToggle, useNavCollapse, type TabSection } from "../components/common/TabNav";
import { IdentityPanel } from "../components/settings/IdentityPanel";
import { SuperAgentPanel } from "../components/settings/SuperAgentPanel";
import { ModelsTab } from "./base/ModelsTab";
import { TelegramGlobalPanel } from "../components/settings/TelegramGlobalPanel";
import { DevicesPanel } from "../components/settings/DevicesPanel";
import { AdvancedPanel } from "../components/settings/AdvancedPanel";
import { AppearancePanel } from "../components/settings/AppearancePanel";
import { STORAGE } from "../constants";
import { t } from "../i18n";

type TabKey =
  | "identity" | "super_agent" | "engines" | "telegram" | "devices" | "appearance" | "advanced";

const SECTIONS: TabSection[] = [
  {
    title: "Cuenta",
    items: [
      { key: "identity",    label: t("settings.tabs.identity"),    icon: User },
      { key: "appearance",  label: t("settings.appearance"),       icon: Palette },
    ],
  },
  {
    title: "Agentes & modelos",
    items: [
      { key: "super_agent", label: t("settings.tabs.super_agent"), icon: Bot },
      { key: "engines",     label: "Modelos",                      icon: Cpu },
    ],
  },
  {
    title: "Canales & dispositivos",
    items: [
      { key: "telegram",    label: t("settings.tabs.telegram"),    icon: Send },
      { key: "devices",     label: t("settings.tabs.devices"),     icon: Smartphone },
    ],
  },
  {
    title: "Avanzado",
    items: [
      { key: "advanced",    label: "Config",    icon: ScrollText },
    ],
  },
];

const PANELS: Record<TabKey, () => ReactElement> = {
  identity:    () => <IdentityPanel />,
  super_agent: () => <SuperAgentPanel />,
  engines:     () => <ModelsTab />,
  telegram:    () => <TelegramGlobalPanel />,
  devices:     () => <DevicesPanel />,
  appearance:  () => <AppearancePanel />,
  advanced:    () => <AdvancedPanel />,
};

export function SettingsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = tabFromPath(location.pathname);
  const Panel = PANELS[active];
  const { collapsed, toggle } = useNavCollapse(STORAGE.sidebarCollapsed + ".settings");
  // Silence lint warnings about unused icons import.
  void KeyRound; void MessageCircle;

  return (
    <div className="flex h-full">
      <TabNav
        sections={SECTIONS}
        active={active}
        onChange={(k) => navigate(k === "identity" ? "/settings" : `/settings/${pathFromTab(k as TabKey)}`)}
        collapsed={collapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="px-6 py-4">
          <div className="flex items-center gap-3">
            <NavToggle collapsed={collapsed} onToggle={toggle} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t("settings.title")}</h1>
              <p className="text-xs text-muted-fg">{t("settings.subtitle")}</p>
            </div>
          </div>
        </header>
        <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
          <Panel />
        </div>
      </div>
    </div>
  );
}

function tabFromPath(pathname: string): TabKey {
  const raw = pathname.split("/").filter(Boolean)[1] || "identity";
  switch (raw) {
    case "super-agent": return "super_agent";
    case "engines": return "engines";
    case "telegram": return "telegram";
    case "devices": return "devices";
    case "appearance": return "appearance";
    case "config":
    case "advanced": return "advanced";
    default: return "identity";
  }
}

function pathFromTab(tab: TabKey): string {
  if (tab === "super_agent") return "super-agent";
  if (tab === "advanced") return "config";
  return tab;
}
