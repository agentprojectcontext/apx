import { ApxProvider, SearchField } from "@apx/ui";

export function Sidebar() {
  return (
    <div style={{ width: 260 }}>
      <SearchField size="sm" />
    </div>
  );
}

export function WithShortcut() {
  return (
    <div style={{ width: 320 }}>
      <SearchField placeholder="Search chats, tasks, files" shortcut={["⌘", "K"]} />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 12, borderRadius: 12, width: 284 }}>
      <SearchField size="sm" placeholder="Buscar" />
    </ApxProvider>
  );
}
