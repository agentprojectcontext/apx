import { ApxProvider, Icons, SegmentedControl } from "@apx/ui";

export function Views() {
  return (
    <SegmentedControl
      options={[
        { value: "chat", label: "Chat" },
        { value: "tasks", label: "Tasks" },
        { value: "board", label: "Board" },
      ]}
    />
  );
}

export function WithIcons() {
  return (
    <SegmentedControl
      defaultValue="dark"
      options={[
        { value: "light", label: "Light", icon: <Icons.Sun /> },
        { value: "dark", label: "Dark", icon: <Icons.Moon /> },
        { value: "system", label: "System", icon: <Icons.Monitor /> },
      ]}
    />
  );
}

export function Small() {
  return (
    <SegmentedControl
      size="sm"
      defaultValue="ask"
      options={[
        { value: "auto", label: "Auto" },
        { value: "ask", label: "Ask" },
        { value: "plan", label: "Plan" },
      ]}
    />
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12 }}>
      <SegmentedControl
        options={[
          { value: "chat", label: "Chat" },
          { value: "tasks", label: "Tareas" },
          { value: "board", label: "Board" },
        ]}
      />
    </ApxProvider>
  );
}
