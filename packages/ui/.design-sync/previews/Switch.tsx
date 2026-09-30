import { ApxProvider, Switch } from "@apx/ui";

const col = { width: 360, display: "flex", flexDirection: "column" as const, gap: 14 };

export function SettingsRows() {
  return (
    <div style={col}>
      <Switch label="Send voice replies" description="Answer voice notes with voice." defaultChecked />
      <Switch label="Quiet hours" description="No notifications 22:00–08:00." />
      <Switch label="Auto-update" disabled />
    </div>
  );
}

export function Bare() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Switch defaultChecked />
      <Switch />
      <Switch size="sm" defaultChecked />
      <Switch size="sm" />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 392 }}>
      <div style={col}>
        <Switch label="Responder con voz" defaultChecked />
        <Switch label="Horario silencioso" />
      </div>
    </ApxProvider>
  );
}
