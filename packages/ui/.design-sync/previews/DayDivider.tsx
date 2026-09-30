import { DayDivider, Message } from "@apx/ui";

export function BetweenMessages() {
  return (
    <div style={{ width: 480, display: "flex", flexDirection: "column" }}>
      <Message>Report filed. 9 receipts, nothing out of policy.</Message>
      <DayDivider label="Today" />
      <Message from="user">Great — archive them.</Message>
    </div>
  );
}
