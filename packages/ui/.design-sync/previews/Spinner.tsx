import { Spinner } from "@apx/ui";

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--apx-fg-muted)" }}>
      <Spinner size={12} />
      <Spinner size={16} />
      <Spinner size={24} />
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <Spinner size={14} label="Loading" /> Connecting to Codex…
      </span>
    </div>
  );
}
