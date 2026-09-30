import { ApxProvider, Badge, Button, Card, Icons } from "@apx/ui";

export function Feature() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: 640 }}>
      <Card
        variant="soft"
        padding="lg"
        title="Works where you work"
        description="Log in once. Roby uses your apps and sites like you would, including the ones that are hard to navigate."
      />
      <Card
        variant="soft"
        padding="lg"
        title="Show it once"
        description="Do a workflow while an agent watches. It saves it as a routine and runs it on its own next time."
      />
    </div>
  );
}

export function Surface() {
  return (
    <div style={{ width: 380 }}>
      <Card
        title="Computer"
        description="Sign in to the helpdesk so I can work the support queue."
        aside={
          <Badge tone="warning" dot>
            You're in control
          </Badge>
        }
      >
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <Button size="sm">Take over</Button>
          <Button size="sm" variant="secondary">
            Hand back
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function Empty() {
  return (
    <div style={{ width: 380 }}>
      <Card variant="outline" padding="lg">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
          <Icons.Inbox size={22} color="var(--apx-fg-subtle)" />
          <strong style={{ fontWeight: 500 }}>Inbox zero</strong>
          <span style={{ color: "var(--apx-fg-muted)", fontSize: 13 }}>Nothing needs you right now.</span>
        </div>
      </Card>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12, width: 412 }}>
      <Card
        title="Motores"
        description="Claude Code y Codex detectados en este equipo."
        aside={<Badge tone="brand">2 activos</Badge>}
      />
    </ApxProvider>
  );
}
