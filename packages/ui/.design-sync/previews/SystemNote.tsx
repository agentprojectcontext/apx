import { AgentChip, ApxProvider, Icons, SystemNote } from "@apx/ui";

const col = { width: 520, display: "flex", flexDirection: "column" as const };

export function Events() {
  return (
    <div style={col}>
      <SystemNote>
        Messages from <AgentChip name="Ledger" blob="amatista" variant="plain" /> and{" "}
        <AgentChip name="Roby" blob="noche" tone="brand" variant="plain" />
      </SystemNote>
      <SystemNote icon={<Icons.Clock />}>
        Created routine <b>Overnight outbound</b>
      </SystemNote>
      <SystemNote>
        Updated memory for <AgentChip name="Account Keeper" blob="lila" />
      </SystemNote>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 8, borderRadius: 10, width: 520 }}>
      <SystemNote icon={<Icons.Brain />}>
        Updated memory for <AgentChip name="Roby" blob="noche" tone="brand" />
      </SystemNote>
    </ApxProvider>
  );
}
