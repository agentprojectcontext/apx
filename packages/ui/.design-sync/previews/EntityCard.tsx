import { ApxProvider, Badge, Button, EntityCard, Icons } from "@apx/ui";

export function EmailDraft() {
  return (
    <EntityCard
      eyebrow="Email draft"
      icon={<Icons.Mail />}
      fields={[
        { label: "To", value: "dana@northwind.co" },
        { label: "Subject", value: "Three infra roles at Northwind" },
      ]}
      actions={
        <>
          <Button size="sm">Send email</Button>
          <Button size="sm" variant="secondary">
            Discard
          </Button>
        </>
      }
    >
      <p>Hi Dana,</p>
      <p>
        Saw Northwind opened three infra roles this month. Usually that means the migration you mentioned in March is
        finally moving.
      </p>
      <p>Worth fifteen minutes next week?</p>
    </EntityCard>
  );
}

export function Task() {
  return (
    <EntityCard
      eyebrow="Task · Acme"
      icon={<Icons.ListChecks />}
      title="Edit reel 26 with the new intro"
      status={
        <Badge tone="warning" dot>
          Needs you
        </Badge>
      }
      fields={[
        { label: "Owner", value: "Albert" },
        { label: "Due", value: "Tomorrow, 18:00" },
      ]}
      actions={
        <>
          <Button size="sm">Approve</Button>
          <Button size="sm" variant="ghost">
            Open task
          </Button>
        </>
      }
    />
  );
}

export function Routine() {
  return (
    <EntityCard
      eyebrow="Routine"
      icon={<Icons.Clock />}
      title="Overnight outbound"
      status={
        <Badge tone="brand" dot>
          Active
        </Badge>
      }
      fields={[
        { label: "Runs", value: "Every Monday, 02:00" },
        { label: "Agent", value: "Outbound" },
      ]}
    />
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12 }}>
      <EntityCard
        eyebrow="Compromiso"
        icon={<Icons.Calendar />}
        title="Mandar el MP4 verificado a Northwind"
        status={<Badge tone="info">En curso</Badge>}
        fields={[{ label: "Vence", value: "Hoy, 20:00" }]}
        actions={
          <>
            <Button size="sm">Marcar hecho</Button>
            <Button size="sm" variant="secondary">
              Posponer
            </Button>
          </>
        }
      />
    </ApxProvider>
  );
}
