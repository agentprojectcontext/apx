import { IconButton, Icons, NavItem, SectionLabel } from "@apx/ui";

export function WithAction() {
  return (
    <div style={{ width: 240 }}>
      <SectionLabel action={<IconButton label="New chat" size="sm" icon={<Icons.Plus />} />}>Chats</SectionLabel>
      <NavItem icon={<Icons.MessageCircle />} label="Ideas for the trip" />
      <NavItem icon={<Icons.MessageCircle />} label="Tax questions" />
    </div>
  );
}
