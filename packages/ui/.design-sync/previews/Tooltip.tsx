import { ApxProvider, IconButton, Icons, Tooltip } from "@apx/ui";

export function Open() {
  return (
    <div style={{ padding: "48px 80px" }}>
      <Tooltip content="New chat" shortcut="⌘N" defaultOpen>
        <IconButton label="New chat" icon={<Icons.SquarePen />} variant="outline" />
      </Tooltip>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: "48px 80px", borderRadius: 12 }}>
      <Tooltip content="Herramientas" defaultOpen>
        <IconButton label="Tools" icon={<Icons.Wrench />} variant="secondary" />
      </Tooltip>
    </ApxProvider>
  );
}
