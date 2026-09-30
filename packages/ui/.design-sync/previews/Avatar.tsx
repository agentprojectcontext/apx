import { Avatar } from "@apx/ui";

export function Initials() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Avatar name="Armand Segall" />
      <Avatar name="Dana Ruiz" status="online" />
      <Avatar name="Mara Ito" size={40} />
      <Avatar name="Kai" size={24} />
    </div>
  );
}

export function Projects() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Avatar name="Acme" shape="square" size={28} />
      <Avatar name="Northwind" shape="square" size={28} />
      <Avatar name="Globex" shape="square" size={28} />
      <Avatar name="Offsite" shape="square" size={28} emoji="🏕️" />
    </div>
  );
}

export function Emoji() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Avatar name="Travel" emoji="✈️" size={36} />
      <Avatar name="Ideas" emoji="💡" size={36} />
    </div>
  );
}
