import { Kbd } from "@apx/ui";

export function Shortcuts() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--apx-fg-muted)" }}>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Kbd keys={["⌘", "K"]} /> Search everything
      </span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Kbd keys={["⌘", "⇧", "H"]} /> Talk to Home
      </span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Kbd keys={["⇧", "⏎"]} /> New line
      </span>
    </div>
  );
}
