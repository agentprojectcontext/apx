import { ApxProvider, Badge } from "@apx/ui";

const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const };

export function Tones() {
  return (
    <div style={row}>
      <Badge>Draft</Badge>
      <Badge tone="brand">Active</Badge>
      <Badge tone="violet">Agent</Badge>
      <Badge tone="info">In progress</Badge>
      <Badge tone="warning" dot>
        You're in control
      </Badge>
      <Badge tone="danger">Failed</Badge>
    </div>
  );
}

export function CountersAndOutline() {
  return (
    <div style={row}>
      <Badge tone="danger" variant="solid">
        5
      </Badge>
      <Badge tone="brand" variant="solid">
        12
      </Badge>
      <Badge variant="outline">Draft</Badge>
      <Badge variant="outline" dot tone="brand">
        Online
      </Badge>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 12, borderRadius: 12 }}>
      <div style={row}>
        <Badge tone="brand">Activo</Badge>
        <Badge tone="warning" dot>
          Te necesita
        </Badge>
        <Badge tone="danger" variant="solid">
          5
        </Badge>
      </div>
    </ApxProvider>
  );
}
