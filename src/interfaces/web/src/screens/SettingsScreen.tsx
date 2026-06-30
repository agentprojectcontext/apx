import { type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bot, Cpu, Database, Globe, KeyRound, LayoutGrid, MessageCircle, Mic, Monitor, ScrollText, Send, Smartphone, Sparkles, User,
} from "lucide-react";
import { useNavCollapse, type TabSection } from "../components/common/TabNav";
import { TabLayout } from "../components/common/TabLayout";
import { IdentityPanel } from "../components/settings/IdentityPanel";
import { SuperAgentPanel } from "../components/settings/SuperAgentPanel";
import { MemoryPanel } from "../components/settings/MemoryPanel";
import { SkillsInspectorPanel } from "../components/settings/SkillsInspectorPanel";
import { ModelsTab } from "./base/ModelsTab";
import { TelegramSettingsTabs } from "../components/settings/TelegramSettingsTabs";
import { DevicesPanel } from "../components/settings/DevicesPanel";
import { AdvancedPanel } from "../components/settings/AdvancedPanel";
import { WebPanel } from "../components/settings/WebPanel";
import { DesktopSettingsPanel } from "../components/settings/DesktopSettingsPanel";
import { VoiceScreen } from "./modules/VoiceScreen";
import { DeckScreen } from "./modules/DeckScreen";
import { STORAGE } from "../constants";
import { t } from "../i18n";

type TabKey =
  | "identity" | "super_agent" | "engines" | "memory" | "skills" | "telegram" | "devices"
  | "voice" | "deck" | "desktop" | "web" | "advanced";

const SECTIONS: TabSection[] = [
  {
    title: t("settings.account_section"),
    items: [
      { key: "identity",    label: t("settings.tabs.identity"),    icon: User },
    ],
  },
  {
    title: t("settings.agents_section"),
    items: [
      { key: "super_agent", label: t("settings.tabs.super_agent"), icon: Bot },
      { key: "engines",     label: t("settings.tabs.engines"),     icon: Cpu },
      { key: "memory",      label: "Memory (RAG)",                 icon: Database },
      { key: "skills",      label: "Skills (RAG)",                 icon: Sparkles },
    ],
  },
  {
    title: t("settings.channels_section"),
    items: [
      { key: "telegram",    label: t("settings.tabs.telegram"),    icon: Send },
      { key: "devices",     label: t("settings.tabs.devices"),     icon: Smartphone },
    ],
  },
  {
    title: t("settings.modules_section"),
    items: [
      { key: "voice",       label: t("nav.modules.voice"),         icon: Mic },
      { key: "desktop",     label: t("nav.modules.desktop"),       icon: Monitor },
      { key: "deck",        label: t("nav.modules.deck"),          icon: LayoutGrid },
      { key: "web",         label: t("nav.modules.web"),           icon: Globe },
    ],
  },
  {
    title: t("settings.advanced_section"),
    items: [
      { key: "advanced",    label: t("settings.tabs.advanced"),    icon: ScrollText },
    ],
  },
];

// Tabs whose content lays out multiple top-level sections in a two-column grid
// on xl (and so wants full available width). Single-section panels (identity,
// super agent, devices, advanced) keep a cosier reading width so wide displays
// don't blow form fields up to absurd widths.
const WIDE_TABS = new Set<TabKey>(["engines", "telegram", "memory", "skills", "web", "voice"]);

const PANELS: Record<TabKey, () => ReactElement> = {
  identity:    () => <IdentityPanel />,
  super_agent: () => <SuperAgentPanel />,
  engines:     () => <ModelsTab />,
  memory:      () => <MemoryPanel />,
  skills:      () => <SkillsInspectorPanel />,
  telegram:    () => <TelegramSettingsTabs />,
  devices:     () => <DevicesPanel />,
  voice:       () => <VoiceScreen />,
  deck:        () => <DeckScreen />,
  desktop:     () => <DesktopSettingsPanel />,
  web:         () => <WebPanel />,
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
    <TabLayout
      sections={SECTIONS}
      active={active}
      onChange={(k) => navigate(k === "identity" ? "/settings" : `/settings/${pathFromTab(k as TabKey)}`)}
      collapsed={collapsed}
      onToggleCollapse={toggle}
      contentClassName={`w-full ${WIDE_TABS.has(active) ? "" : "mx-auto max-w-3xl"} space-y-6 p-6 pt-3`}
      testId={`settings-tab-${active}`}
    >
      <Panel />
    </TabLayout>
  );
}

function tabFromPath(pathname: string): TabKey {
  const raw = pathname.split("/").filter(Boolean)[1] || "identity";
  switch (raw) {
    case "super-agent": return "super_agent";
    case "engines": return "engines";
    case "memory": return "memory";
    case "skills": return "skills";
    case "telegram": return "telegram";
    case "devices": return "devices";
    case "voice": return "voice";
    case "deck": return "deck";
    case "desktop": return "desktop";
    case "web": return "web";
    case "appearance": return "web"; // legacy route → Web module
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
