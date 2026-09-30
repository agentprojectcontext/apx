import { AgentAvatar, BLOB_NAMES } from "@apx/ui";

export function Catalog() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 44px)", gap: 10 }}>
      {BLOB_NAMES.map((b) => (
        <div key={b} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <AgentAvatar name={b} blob={b} size={36} animated={false} />
          <span style={{ fontSize: 9, color: "var(--apx-fg-subtle)" }}>{b}</span>
        </div>
      ))}
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
      <AgentAvatar name="Roby" blob="noche" size={16} />
      <AgentAvatar name="Roby" blob="noche" size={24} />
      <AgentAvatar name="Roby" blob="noche" size={32} />
      <AgentAvatar name="Roby" blob="noche" size={48} status="online" />
      <AgentAvatar name="Roby" blob="noche" size={64} />
    </div>
  );
}

export function Fallback() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <AgentAvatar name="Ledger" blob="menta" size={36} status="busy" />
      <AgentAvatar name="Night Shift" size={36} />
      <AgentAvatar name="Legacy Bot" blob="unknown-blob" size={36} status="away" />
    </div>
  );
}
