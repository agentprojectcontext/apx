import { ApxProvider, Icons, Input, Kbd } from "@apx/ui";

const col = { width: 320, display: "flex", flexDirection: "column" as const, gap: 10 };

export function Default() {
  return (
    <div style={col}>
      <Input placeholder="Project name" />
      <Input placeholder="Folder" leadingIcon={<Icons.Folder size={15} />} defaultValue="~/work/acme" />
      <Input placeholder="Command" trailing={<Kbd keys={["⏎"]} />} />
    </div>
  );
}

export function SizesAndStates() {
  return (
    <div style={col}>
      <Input size="sm" placeholder="Small filter" />
      <Input size="lg" placeholder="What should we call your secretary?" />
      <Input invalid defaultValue="not-an-email" />
      <Input disabled placeholder="Disabled" />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 352 }}>
      <div style={col}>
        <Input placeholder="Nombre del proyecto" />
        <Input leadingIcon={<Icons.Folder size={15} />} defaultValue="~/work/acme" />
      </div>
    </ApxProvider>
  );
}
