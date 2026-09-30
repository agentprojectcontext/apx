import { StatusIcon } from "@apx/ui";

export function AllStates() {
  const s = { display: "flex", gap: 6, alignItems: "center", fontSize: 13 };
  return (
    <div style={{ display: "flex", gap: 20 }}>
      <span style={s}>
        <StatusIcon status="done" /> Done
      </span>
      <span style={s}>
        <StatusIcon status="running" /> Running
      </span>
      <span style={s}>
        <StatusIcon status="failed" /> Failed
      </span>
      <span style={s}>
        <StatusIcon status="pending" /> Pending
      </span>
    </div>
  );
}
