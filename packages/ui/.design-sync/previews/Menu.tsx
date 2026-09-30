import { IconButton, Icons, Menu } from "@apx/ui";

export function Open() {
  return (
    <div style={{ height: 250, padding: 8 }}>
      <Menu
        defaultOpen
        trigger={<IconButton label="Chat actions" icon={<Icons.Ellipsis />} variant="outline" />}
        items={[
          { type: "label", label: "Outbound" },
          { label: "Rename", icon: <Icons.Pencil /> },
          { label: "Pin to sidebar", icon: <Icons.Pin />, shortcut: "⌘P" },
          { label: "Copy link", icon: <Icons.Link /> },
          { type: "separator" },
          { label: "Delete chat", icon: <Icons.Trash2 />, danger: true },
        ]}
      />
    </div>
  );
}
