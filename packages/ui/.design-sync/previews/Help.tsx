import { Help } from "@apx/ui";

export function Open() {
  return (
    <div style={{ padding: "24px 24px 220px", display: "flex", alignItems: "center", gap: 6 }}>
      <strong>Columns</strong>
      <Help
        label="About columns"
        title="Columns"
        items={[
          { term: "Backlog", text: "New or not planned yet." },
          { term: "To do", text: "Decided; it is next." },
          { term: "Doing", text: "Someone is working on it now." },
          { term: "Review", text: "Done, waiting for someone to check it." },
        ]}
      />
    </div>
  );
}
