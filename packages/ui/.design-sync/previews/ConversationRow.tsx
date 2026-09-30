import { AgentAvatar, ApxProvider, AvatarStack, ConversationRow, Icons, Tag } from "@apx/ui";

const list = { width: 300, display: "flex", flexDirection: "column" as const, gap: 2 };

export function Minimal() {
  return (
    <div style={list}>
      <ConversationRow
        avatar={<AgentAvatar name="Roby" blob="noche" size={34} />}
        title="Roby"
        time="Yesterday"
        preview="Booked the venue and sent the calendar invite."
      />
      <ConversationRow
        avatar={<AgentAvatar name="Outbound" blob="brasa" size={34} />}
        title="Outbound"
        time="1:35 p. m."
        preview="Done."
        selected
      />
      <ConversationRow
        avatar={<AgentAvatar name="Inbox Keeper" blob="zafiro" size={34} />}
        title="Inbox Keeper"
        time="10:34 a. m."
        preview="Inbox at zero, 5 drafts parked for you."
        unread={3}
      />
      <ConversationRow
        avatar={
          <AvatarStack size={22}>
            <AgentAvatar name="Ledger" blob="menta" size={22} animated={false} />
            <AgentAvatar name="Scout" blob="amatista" size={22} animated={false} />
          </AvatarStack>
        }
        title="Offsite crew"
        time="7:34 a. m."
        typing="Ledger is typing…"
      />
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 8, borderRadius: 12 }}>
      <div style={list}>
        <ConversationRow
          avatar={<AgentAvatar name="Roby" blob="noche" size={34} />}
          title="Roby"
          titleTag={<Tag kind="role">Super-agente</Tag>}
          time="01:29 p. m."
          tags={<Tag icon={<Icons.Send />}>Telegram</Tag>}
          preview="Roby en marcha: ya tengo las ideas."
          selected
        />
        <ConversationRow
          avatar={<AgentAvatar name="Albert" blob="aqua" size={34} />}
          title="Albert · Scout"
          time="01:22 p. m."
          tags={
            <>
              <Tag icon={<Icons.Folder />}>Acme</Tag>
              <Tag>Agente ↔ agente</Tag>
            </>
          }
          preview="scout: la carpeta del reel tiene solo el guion."
        />
        <ConversationRow
          avatar={<AgentAvatar name="Coral" blob="coral" size={34} />}
          title="Coral"
          time="12:44 p. m."
          tags={
            <>
              <Tag icon={<Icons.Folder />}>Acme</Tag>
              <Tag>Grupos</Tag>
            </>
          }
          preview="No recibí una aprobación visible todavía."
          unread={2}
        />
      </div>
    </ApxProvider>
  );
}
