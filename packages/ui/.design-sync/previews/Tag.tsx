import { ApxProvider, Icons, Tag } from "@apx/ui";

const row = { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const };

function Set() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={row}>
        <Tag kind="role">Super-agente</Tag>
        <Tag kind="role">Secretary</Tag>
      </div>
      <div style={row}>
        <Tag icon={<Icons.Folder />}>Acme</Tag>
        <Tag icon={<Icons.Send />}>Telegram</Tag>
        <Tag>Agente ↔ agente</Tag>
        <Tag>Web</Tag>
      </div>
      <div style={row}>
        <Tag kind="skill">react-guardrails</Tag>
        <Tag kind="skill">skill-builder</Tag>
      </div>
    </div>
  );
}

export function Minimal() {
  return <Set />;
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 12, borderRadius: 12 }}>
      <Set />
    </ApxProvider>
  );
}
