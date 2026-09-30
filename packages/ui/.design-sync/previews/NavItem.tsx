import { ApxProvider, Avatar, IconButton, Icons, NavItem, SectionLabel } from "@apx/ui";

function Sidebar() {
  return (
    <div
      style={{
        width: 240,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: 8,
        background: "var(--apx-sidebar)",
        borderRadius: 12,
      }}
    >
      <NavItem icon={<Icons.House />} label="Home" active />
      <NavItem icon={<Icons.Inbox />} label="Inbox" count={3} attention />
      <NavItem icon={<Icons.RefreshCw />} label="In progress" count={2} />
      <SectionLabel action={<IconButton label="New project" size="sm" icon={<Icons.Plus />} />}>Projects</SectionLabel>
      <NavItem icon={<Avatar name="Acme" shape="square" size={18} />} label="Acme" />
      <NavItem depth={1} label="Chat with agents" />
      <NavItem depth={1} label="Tasks · Board" active={false} />
      <NavItem icon={<Avatar name="Northwind" shape="square" size={18} />} label="Northwind" />
      <NavItem icon={<Icons.Settings />} label="Settings" />
    </div>
  );
}

export function Minimal() {
  return <Sidebar />;
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 8, borderRadius: 12, width: 256 }}>
      <Sidebar />
    </ApxProvider>
  );
}
