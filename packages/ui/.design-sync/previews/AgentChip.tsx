import { AgentChip } from "@apx/ui";

export function Chips() {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <AgentChip name="Account Keeper" blob="lila" />
      <AgentChip name="Roby" blob="noche" tone="brand" />
      <AgentChip name="Scout" blob="zafiro" tone="info" />
      <AgentChip name="Archive" tone="neutral" />
    </div>
  );
}

export function InSentence() {
  return (
    <p style={{ width: 460, margin: 0 }}>
      <AgentChip name="Account Keeper" blob="lila" variant="plain" /> sent over the Acme and Globex threads and{" "}
      <AgentChip name="Roby" blob="noche" tone="brand" variant="plain" /> flagged the priority accounts.
    </p>
  );
}
