import { ApxProvider, Checkbox } from "@apx/ui";

const col = { width: 340, display: "flex", flexDirection: "column" as const, gap: 12 };

export function Options() {
  return (
    <div style={col}>
      <Checkbox label="Include archived chats" defaultChecked />
      <Checkbox label="Only this project" description="Search Acme and nothing else." />
      <Checkbox label="Select all (3 of 8)" indeterminate />
      <Checkbox label="Unavailable" disabled />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 372 }}>
      <div style={col}>
        <Checkbox label="Incluir chats archivados" defaultChecked />
        <Checkbox label="Solo este proyecto" />
      </div>
    </ApxProvider>
  );
}
