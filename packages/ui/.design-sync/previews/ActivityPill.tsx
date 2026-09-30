import { ActivityPill, AgentAvatar, ApxProvider, AvatarStack } from "@apx/ui";

export function Handoff() {
  return (
    <ActivityPill
      tone="danger"
      label="Sending to Roby…"
      from={
        <AvatarStack size={26}>
          <AgentAvatar name="Ledger" blob="menta" size={26} />
          <AgentAvatar name="Scout" blob="amatista" size={26} />
        </AvatarStack>
      }
      to={<AgentAvatar name="Roby" blob="noche" size={26} />}
    />
  );
}

export function Tones() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <ActivityPill label="Roby is writing…" from={<AgentAvatar name="Roby" blob="noche" size={24} />} />
      <ActivityPill tone="brand" label="Running Overnight outbound" />
      <ActivityPill
        tone="violet"
        label="Scout is asking Ledger"
        from={<AgentAvatar name="Scout" blob="amatista" size={24} />}
        to={<AgentAvatar name="Ledger" blob="menta" size={24} />}
      />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12 }}>
      <ActivityPill
        tone="brand"
        label="Albert está renderizando…"
        from={<AgentAvatar name="Albert" blob="aqua" size={24} />}
      />
    </ApxProvider>
  );
}
