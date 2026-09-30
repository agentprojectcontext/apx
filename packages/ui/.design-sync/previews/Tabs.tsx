import { ApxProvider, Icons, Tabs } from "@apx/ui";

const sections = [
  {
    value: "chat",
    label: "Chat",
    icon: <Icons.MessageCircle />,
    content: <p style={{ margin: 0, color: "var(--apx-fg-muted)" }}>3 agents are talking in this project.</p>,
  },
  { value: "tasks", label: "Tasks", icon: <Icons.ListChecks />, count: 12 },
  { value: "board", label: "Board", icon: <Icons.LayoutGrid /> },
  { value: "routines", label: "Routines", icon: <Icons.Clock />, count: 3 },
  { value: "files", label: "Files", icon: <Icons.Folder /> },
];

export function Underline() {
  return (
    <div style={{ width: 560 }}>
      <Tabs items={sections} />
    </div>
  );
}

export function Pill() {
  return (
    <Tabs
      variant="pill"
      items={[
        { value: "all", label: "All" },
        { value: "mine", label: "Mine", count: 4 },
        { value: "done", label: "Done" },
      ]}
    />
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 592 }}>
      <Tabs items={sections} defaultValue="tasks" />
    </ApxProvider>
  );
}
