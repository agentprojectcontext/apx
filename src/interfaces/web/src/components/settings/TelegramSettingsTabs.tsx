// Tabbed container for Settings → Telegram. The previous single panel only
// edited the default channel; this hosts the full Telegram config surface:
// default channel, the full channel list, contacts roster and roles map.

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TelegramGlobalPanel } from "./TelegramGlobalPanel";
import { TelegramChannelsPanel } from "./TelegramChannelsPanel";
import { TelegramContactsPanel } from "./TelegramContactsPanel";
import { TelegramRolesPanel } from "./TelegramRolesPanel";

const STORAGE_KEY = "apx.settings.telegramTab";
type Tab = "default" | "channels" | "contacts" | "roles";

function readTab(): Tab {
  if (typeof window === "undefined") return "default";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "channels" || raw === "contacts" || raw === "roles" || raw === "default") return raw;
  return "default";
}

export function TelegramSettingsTabs() {
  const [tab, setTab] = useState<Tab>("default");
  useEffect(() => { setTab(readTab()); }, []);
  const onChange = (v: string) => {
    const t = (v === "channels" || v === "contacts" || v === "roles" || v === "default" ? v : "default") as Tab;
    setTab(t);
    try { window.localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  };

  return (
    <Tabs value={tab} onValueChange={onChange} className="w-full">
      <TabsList>
        <TabsTrigger value="default">Canal default</TabsTrigger>
        <TabsTrigger value="channels">Canales</TabsTrigger>
        <TabsTrigger value="contacts">Contactos</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>

      <TabsContent value="default" className="mt-4">
        <TelegramGlobalPanel />
      </TabsContent>
      <TabsContent value="channels" className="mt-4">
        <TelegramChannelsPanel />
      </TabsContent>
      <TabsContent value="contacts" className="mt-4">
        <TelegramContactsPanel />
      </TabsContent>
      <TabsContent value="roles" className="mt-4">
        <TelegramRolesPanel />
      </TabsContent>
    </Tabs>
  );
}
