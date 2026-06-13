import { type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Bot, Cpu, Database, KeyRound, MessageCircle, Palette, ScrollText, Send, Smartphone, Sparkles, User,
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
import { AppearancePanel } from "../components/settings/AppearancePanel";
import { STORAGE } from "../constants";
import { t } from "../i18n";

type TabKey =
  | "identity" | "super_agent" | "engines" | "memory" | "skills" | "telegram" | "devices" | "appearance" | "advanced";

const SECTIONS: TabSection[] = [
  {
    title: t("settings.account_section"),
    items: [
      { key: "identity",    label: t("settings.tabs.identity"),    icon: User },
      { key: "appearance",  label: t("settings.appearance"),       icon: Palette },
    ],
  },
  {
    title: t("settings.agents_section"),
    items: [
      { key: "super_agent", label: t("settings.tabs.super_agent"), icon: Bot },
      { key: "engines",     label: t("settings.tabs.engines"),     icon: Cpu },
      { key: "memory",      label: "Memoria (RAG)",                icon: Database },
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
    title: t("settings.advanced_section"),
    items: [
      { key: "advanced",    label: t("settings.tabs.advanced"),    icon: ScrollText },
    ],
  },
];

// Tabs whose content (model router + provider grid, telegram tabs) benefits
// from a wider container; the rest keep the cosier 3xl reading width.
const WIDE_TABS = new Set<TabKey>(["engines", "telegram"]);

const PANELS: Record<TabKey, () => ReactElement> = {
  identity:    () => <IdentityPanel />,
  super_agent: () => <SuperAgentPanel />,
  engines:     () => <ModelsTab />,
  memory:      () => <MemoryPanel />,
  skills:      () => <SkillsInspectorPanel />,
  telegram:    () => <TelegramSettingsTabs />,
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
    <TabLayout
      sections={SECTIONS}
      active={active}
      onChange={(k) => navigate(k === "identity" ? "/settings" : `/settings/${pathFromTab(k as TabKey)}`)}
      collapsed={collapsed}
      onToggleCollapse={toggle}
      contentClassName={`mx-auto w-full ${WIDE_TABS.has(active) ? "max-w-6xl" : "max-w-3xl"} space-y-6 p-6 pt-3`}
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
