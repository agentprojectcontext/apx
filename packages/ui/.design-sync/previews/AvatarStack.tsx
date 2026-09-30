import { AgentAvatar, Avatar, AvatarStack } from "@apx/ui";

export function Agents() {
  return (
    <AvatarStack size={28}>
      <AgentAvatar name="Ledger" blob="menta" size={28} animated={false} />
      <AgentAvatar name="Scout" blob="amatista" size={28} animated={false} />
      <AgentAvatar name="Roby" blob="noche" size={28} animated={false} />
    </AvatarStack>
  );
}

export function Overflow() {
  return (
    <AvatarStack size={28} max={3}>
      <Avatar name="Armand Segall" size={28} />
      <Avatar name="Dana Ruiz" size={28} />
      <Avatar name="Mara Ito" size={28} />
      <Avatar name="Kai Moreno" size={28} />
      <Avatar name="Lu Chen" size={28} />
    </AvatarStack>
  );
}
